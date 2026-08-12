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
from app.services import font_library


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


# Every entry must resolve to a real installed face. Adding one without the
# font present produces a preview that quietly disagrees with the render —
# libass falls back to DejaVu Sans and says nothing. `test_caption_style.py`
# asks fontconfig to confirm each `render_name`, so that failure is a red test
# rather than a surprise in an exported MP4.
#
# Two groups, and they get there differently.
#
# The first four are system faces from backend/Dockerfile, paired with a
# *metric-compatible* browser stack: Arial and Liberation Sans have identical
# advance widths, so lines wrap in the same place even though the two
# renderers load different files. Close enough, and it costs nothing to ship.
#
# The rest are vendored in frontend/public/fonts and mounted into this
# container by docker-compose, so libass and the browser read the *same bytes*
# — no metric-compatibility argument required, because there is only one file.
# Their css_stack names the family directly; @font-face in globals.css points
# the browser at the identical .ttf.
#
# Static weights only. Google now ships Inter, Roboto, Montserrat and Oswald
# as variable fonts, and libass would take the default instance and synthesise
# a fake bold while the browser interpolated a real one — a disagreement in
# exactly the place this table exists to prevent.
FONTS: tuple[Font, ...] = (
    Font("sans", "Sans", "Liberation Sans", 'Arial, "Liberation Sans", Helvetica, sans-serif'),
    Font("serif", "Serif", "Liberation Serif", '"Times New Roman", "Liberation Serif", serif'),
    Font("mono", "Mono", "Liberation Mono", '"Courier New", "Liberation Mono", monospace'),
    Font("dejavu", "DejaVu", "DejaVu Sans", '"DejaVu Sans", Verdana, sans-serif'),
    # Geometric sans. The default for social captions for a reason.
    Font("poppins", "Poppins", "Poppins", '"Poppins", sans-serif'),
    # Humanist sans, quieter than Poppins and easier over long stretches.
    Font("lato", "Lato", "Lato", '"Lato", sans-serif'),
    # Condensed: fits noticeably more words on a line before wrapping, which
    # matters most on vertical video.
    Font(
        "barlow-condensed",
        "Barlow Condensed",
        "Barlow Condensed",
        '"Barlow Condensed", "Arial Narrow", sans-serif',
    ),
    # Display weights, one cut each. Both are single-weight families, so the
    # bold toggle is synthesised — by libass and by the browser alike, which is
    # at least the same kind of wrong in both.
    Font("anton", "Anton", "Anton", '"Anton", Impact, sans-serif'),
    Font("bebas-neue", "Bebas Neue", "Bebas Neue", '"Bebas Neue", Impact, sans-serif'),
)

FONTS_BY_KEY = {font.key: font for font in FONTS}
DEFAULT_FONT_KEY = "sans"


def get_font(key: str) -> Font:
    """
    Resolve a font key, from the built-in table or the Google Fonts library.

    Never raises: an unknown key falls back rather than breaking playback.

    The built-ins are checked first and always work offline — four system faces
    from the image and five vendored in the repo. Everything else comes from
    the catalogue and is downloaded on first use; by the time a style names one
    the file is already on disk, because the editor cannot select a font
    without the endpoint having fetched it.
    """
    builtin = FONTS_BY_KEY.get(key)
    if builtin is not None:
        return builtin

    entry = font_library.get(key)
    if entry is not None:
        # The browser is served this exact file from /api/fonts, so the stack
        # names the family alone — there is no metric-compatible stand-in to
        # fall back to, and a generic fallback would hide a failed download
        # behind text that renders in something else.
        return Font(entry.key, entry.family, entry.family, f'"{entry.family}", sans-serif')

    return FONTS_BY_KEY[DEFAULT_FONT_KEY]


# Presets are plain dicts of column values so applying one is an ordinary
# update — no separate code path that could drift from a hand-made style.
#
# Every preset must name *every* styling column. A preset is "make it look like
# this", and a field left out is a field left at whatever the user last set,
# so an omitted key means picking YouTube would keep the shadow you added
# five minutes ago. `test_presets_are_complete` enforces it against the model
# rather than trusting this comment.
_PRESET_BASELINE: dict = {
    "shadow": 0,
    "shadow_color": "#000000",
    "underline": False,
    "strikeout": False,
    "letter_spacing": 0,
    "uppercase": False,
    "box_padding": 8,
}

PRESETS: dict[str, dict] = {
    "youtube": {
        **_PRESET_BASELINE,
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
        **_PRESET_BASELINE,
        "font_key": "sans",
        "font_size": 64,
        "bold": True,
        "italic": False,
        # The look is set in caps far more often than not, and it is the one
        # part of this style that a size or colour change cannot approximate.
        "uppercase": True,
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
        **_PRESET_BASELINE,
        "font_key": "sans",
        "font_size": 44,
        "bold": False,
        "italic": False,
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 2,
        # A hair of shadow instead of a heavier outline: it lifts the text off
        # a busy frame without the stroke reading as a border.
        "shadow": 3,
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
        "Underline": -1 if style.underline else 0,
        "StrikeOut": -1 if style.strikeout else 0,
        "PrimaryColour": to_ass_colour(style.text_color),
        "OutlineColour": to_ass_colour(style.outline_color),
        #
        # BackColour is two different things depending on BorderStyle: the box
        # fill at 3, the drop-shadow colour at 1. One field, so it has to follow
        # whichever is actually being drawn.
        #
        # Getting this wrong is invisible rather than loud. Leaving it as the
        # box colour at box_opacity means an unboxed style hands the shadow an
        # alpha of 0 — ASS alpha is *transparency* — and the shadow renders
        # perfectly, fully invisible, with no error anywhere.
        "BackColour": (
            to_ass_colour(style.box_color, style.box_opacity)
            if boxed
            else to_ass_colour(style.shadow_color)
        ),
        # 3 draws an opaque box behind the text; 1 draws an outline and shadow.
        "BorderStyle": 3 if boxed else 1,
        # This field changes meaning with BorderStyle too: stroke width at 1,
        # box padding at 3.
        "Outline": round((style.box_padding if boxed else style.outline_width) * scale),
        # A box already separates the text from the frame, and BackColour is
        # spoken for, so the shadow is only drawn when there is no box.
        "Shadow": 0 if boxed else round(style.shadow * scale),
        "Spacing": round(style.letter_spacing * scale),
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
#
# ScaleX/ScaleY and Angle stay fixed deliberately rather than for lack of a
# control: stretching or rotating glyphs changes their advance widths, so
# libass and the browser would break lines in different places and the preview
# would stop being a promise. SecondaryColour is only read for karaoke, which
# needs word timings we do not store.
_ASS_DEFAULTS: dict[str, str | int] = {
    "Name": "Default",
    "SecondaryColour": "&H000000FF",
    "ScaleX": 100,
    "ScaleY": 100,
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
