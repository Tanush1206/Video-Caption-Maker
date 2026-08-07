"""
Caption appearance: defaults, presets, and the mapping to ASS.

The editor previews captions in the browser with CSS; Milestone 8 will burn
them in with FFmpeg's libass filter. Those are two completely different text
renderers, and the milestone is only done if they agree. Everything here
exists to make that true:

  - Fonts are a fixed table, not free text, because libass silently
    substitutes a family it doesn't have and the preview would never know.
  - Each font names a *metric-compatible* browser stack, so glyph widths and
    therefore line breaks match even though the two renderers load different
    files.
  - Sizes are stored against a 1080p canvas and scaled by the real height at
    both ends, so one style means the same thing on a 360p and a 4K video.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption_style import (
    REFERENCE_HEIGHT,
    Alignment,
    CaptionStyle,
    VerticalPosition,
)


@dataclass(frozen=True)
class Font:
    """
    One selectable face.

    `render_name` is what libass is asked for and must be installed in the
    worker image. `css_stack` is what the browser is asked for, and is chosen
    to be metric-compatible — Arial and Liberation Sans have identical advance
    widths, so text wraps in the same place in both renderers even though the
    glyphs come from different files.
    """

    key: str
    label: str
    render_name: str
    css_stack: str


# Keep in step with the fonts installed in backend/Dockerfile. Adding an entry
# here without installing the font produces a preview that quietly disagrees
# with the render, which is the exact failure this table exists to prevent.
FONTS: tuple[Font, ...] = (
    Font("sans", "Sans", "Liberation Sans", 'Arial, "Liberation Sans", Helvetica, sans-serif'),
    Font("serif", "Serif", "Liberation Serif", '"Times New Roman", "Liberation Serif", serif'),
    Font("mono", "Mono", "Liberation Mono", '"Courier New", "Liberation Mono", monospace'),
    Font("dejavu", "DejaVu", "DejaVu Sans", '"DejaVu Sans", Verdana, sans-serif'),
)

FONTS_BY_KEY = {font.key: font for font in FONTS}
DEFAULT_FONT_KEY = "sans"


def get_font(key: str) -> Font:
    """Never raises: an unknown key falls back rather than breaking playback."""
    return FONTS_BY_KEY.get(key, FONTS_BY_KEY[DEFAULT_FONT_KEY])


# Presets are plain dicts of column values so applying one is an ordinary
# update — no separate code path that could drift from a hand-made style.
PRESETS: dict[str, dict] = {
    "youtube": {
        "font_key": "sans",
        "font_size": 48,
        "bold": False,
        "italic": False,
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0,
        "box_color": "#000000",
        "box_opacity": 0.75,
        "position": VerticalPosition.BOTTOM,
        "alignment": Alignment.CENTER,
        "margin_v": 60,
        "margin_h": 60,
    },
    "tiktok": {
        "font_key": "sans",
        "font_size": 64,
        "bold": True,
        "italic": False,
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 5,
        "box_color": "#000000",
        "box_opacity": 0.0,
        # Centred vertically, because the bottom of a phone screen is covered
        # by the caption, handle and buttons of whatever app it's played in.
        "position": VerticalPosition.MIDDLE,
        "alignment": Alignment.CENTER,
        "margin_v": 0,
        "margin_h": 80,
    },
    "minimal": {
        "font_key": "sans",
        "font_size": 44,
        "bold": False,
        "italic": False,
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 2,
        "box_color": "#000000",
        "box_opacity": 0.0,
        "position": VerticalPosition.BOTTOM,
        "alignment": Alignment.CENTER,
        "margin_v": 48,
        "margin_h": 60,
    },
}


def default_style_fields() -> dict:
    """
    The model's own column defaults, read back off the columns.

    Not `CaptionStyle()` — SQLAlchemy applies `default=` at *flush* time, so a
    freshly constructed instance has None in every one of these fields. Reading
    an unsaved object would silently reset a style to nulls.

    Introspecting the columns keeps this in step with the model instead of
    repeating all fourteen values somewhere they can drift.
    """
    skip = {"id", "video_id", "created_at", "updated_at"}
    return {
        column.name: column.default.arg
        for column in CaptionStyle.__table__.columns
        if column.name not in skip and column.default is not None
    }


async def get_style(db: AsyncSession, video_id: int) -> CaptionStyle | None:
    result = await db.execute(
        select(CaptionStyle).where(CaptionStyle.video_id == video_id)
    )
    return result.scalar_one_or_none()


async def get_or_create_style(db: AsyncSession, video_id: int) -> CaptionStyle:
    """
    The style row is created on first read, not on upload.

    Most videos are never restyled, and a row of pure defaults for every one of
    them is a row that can drift from the defaults in the model when those
    change. Creating it when someone actually looks keeps the two in step.
    """
    style = await get_style(db, video_id)
    if style is not None:
        return style

    style = CaptionStyle(video_id=video_id)
    db.add(style)
    await db.commit()
    await db.refresh(style)
    return style


async def update_style(db: AsyncSession, style: CaptionStyle, changes: dict) -> CaptionStyle:
    for field, value in changes.items():
        setattr(style, field, value)
    await db.commit()
    await db.refresh(style)
    return style


async def apply_preset(db: AsyncSession, style: CaptionStyle, name: str) -> CaptionStyle:
    if name not in PRESETS:
        raise ValueError(f"Unknown preset: {name}")
    return await update_style(db, style, dict(PRESETS[name]))


# ── ASS conversion ───────────────────────────────────────────────────────
#
# Written now, in Milestone 7 rather than 8, because it is the definition of
# what the preview is previewing. Getting it wrong is not a rendering bug
# discovered later — it means the editor was lying the whole time.


def scale_for(height: int) -> float:
    """How much to multiply reference-pixel sizes by for a real video."""
    return height / REFERENCE_HEIGHT


def _bgr(hex_colour: str) -> str:
    """RRGGBB -> BBGGRR. ASS orders the channels backwards from hex, blue first."""
    value = hex_colour.lstrip("#").upper()
    return f"{value[4:6]}{value[2:4]}{value[0:2]}"


def to_ass_colour(hex_colour: str, opacity: float = 1.0) -> str:
    """
    #RRGGBB -> &HAABBGGRR, the form a `Style:` line takes.

    The alpha byte is *transparency*, not opacity: 0 is fully visible and 255
    invisible — the exact opposite of every other alpha you will touch that day.
    """
    transparency = round((1.0 - max(0.0, min(1.0, opacity))) * 255)
    return f"&H{transparency:02X}{_bgr(hex_colour)}"


def to_ass_inline_colour(hex_colour: str) -> str:
    """
    #RRGGBB -> &HBBGGRR&, the form the inline `\\c` override tag takes.

    A different shape from the style version: no alpha byte, and a trailing
    ampersand. Passing one where the other is expected parses without error and
    renders the wrong colour.
    """
    return f"&H{_bgr(hex_colour)}&"


# ASS alignment follows a numeric keypad: 1-3 along the bottom, 4-6 the
# middle, 7-9 the top, left to right within each row.
_ASS_ALIGNMENT = {
    (VerticalPosition.BOTTOM, Alignment.LEFT): 1,
    (VerticalPosition.BOTTOM, Alignment.CENTER): 2,
    (VerticalPosition.BOTTOM, Alignment.RIGHT): 3,
    (VerticalPosition.MIDDLE, Alignment.LEFT): 4,
    (VerticalPosition.MIDDLE, Alignment.CENTER): 5,
    (VerticalPosition.MIDDLE, Alignment.RIGHT): 6,
    (VerticalPosition.TOP, Alignment.LEFT): 7,
    (VerticalPosition.TOP, Alignment.CENTER): 8,
    (VerticalPosition.TOP, Alignment.RIGHT): 9,
}


def to_ass_alignment(style: CaptionStyle) -> int:
    return _ASS_ALIGNMENT[(style.position, style.alignment)]


def to_ass_style(style: CaptionStyle, height: int) -> dict[str, str | int]:
    """
    The fields of an ASS `Style:` line, as a dict.

    A dict rather than a formatted string so the values can be asserted
    individually in tests. Use `to_ass_style_block` to serialise it — the
    ordering is not something a caller should redo.
    """
    scale = scale_for(height)
    boxed = style.box_opacity > 0

    return {
        "Fontname": get_font(style.font_key).render_name,
        "Fontsize": round(style.font_size * scale),
        # ASS booleans are -1 for true. Not 1 — that is a different value and
        # libass treats it as false.
        "Bold": -1 if style.bold else 0,
        "Italic": -1 if style.italic else 0,
        "PrimaryColour": to_ass_colour(style.text_color),
        "OutlineColour": to_ass_colour(style.outline_color),
        # Doubles as the box fill at BorderStyle 3 and the drop shadow at 1.
        "BackColour": to_ass_colour(style.box_color, style.box_opacity),
        # 3 draws an opaque box behind the text; 1 draws an outline and shadow.
        "BorderStyle": 3 if boxed else 1,
        # This field changes meaning with BorderStyle: stroke width at 1, box
        # padding at 3. The padding rule lives on the model so the browser
        # preview can apply the identical number.
        "Outline": round((style.box_padding if boxed else style.outline_width) * scale),
        "Shadow": 0,
        "Alignment": to_ass_alignment(style),
        "MarginL": round(style.margin_h * scale),
        "MarginR": round(style.margin_h * scale),
        "MarginV": round(style.margin_v * scale),
    }


# The V4+ field order. `Name` first is not optional: libass reads the Format
# line positionally, so omitting it shifts every value one place left and the
# font name is silently read as the style name. The symptom is a caption that
# renders in a substituted font with no error anywhere — which is precisely the
# failure this module exists to prevent, so the block is generated rather than
# hand-assembled by each caller.
ASS_STYLE_FIELDS: tuple[str, ...] = (
    "Name", "Fontname", "Fontsize", "PrimaryColour", "SecondaryColour",
    "OutlineColour", "BackColour", "Bold", "Italic", "Underline", "StrikeOut",
    "ScaleX", "ScaleY", "Spacing", "Angle", "BorderStyle", "Outline", "Shadow",
    "Alignment", "MarginL", "MarginR", "MarginV", "Encoding",
)

# Fields we don't expose but that must still occupy their position in the row.
_ASS_DEFAULTS: dict[str, str | int] = {
    "Name": "Default",
    "SecondaryColour": "&H000000FF",
    "Underline": 0,
    "StrikeOut": 0,
    "ScaleX": 100,
    "ScaleY": 100,
    "Spacing": 0,
    "Angle": 0,
    "Encoding": 1,
}


def to_ass_style_block(style: CaptionStyle, height: int) -> str:
    """
    The complete `[V4+ Styles]` section.

    Both lines come from one ordered tuple, so the Format line and the Style
    line cannot disagree about which column is which.
    """
    values = {**_ASS_DEFAULTS, **to_ass_style(style, height)}
    row = ",".join(str(values[field]) for field in ASS_STYLE_FIELDS)

    return (
        "[V4+ Styles]\n"
        f"Format: {', '.join(ASS_STYLE_FIELDS)}\n"
        f"Style: {row}\n"
    )
