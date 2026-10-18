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

import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption_style import (
    REFERENCE_HEIGHT,
    Alignment,
    CaptionStyle,
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
# as variable fonts, and handing one to both renderers does not work: libass
# takes the default instance and synthesises a fake bold while the browser
# interpolates a real one — a disagreement in exactly the place this table
# exists to prevent.
#
# Those four are available all the same, through the catalogue rather than this
# table: font_library pins the axes at download time and writes a genuine static
# cut, which restores the one-file property this list gets from vendoring.
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


# Scripts drawn in a font of their own, whatever the caption font is.
#
# Caption fonts are Latin faces, so these scripts were always drawn by some
# fallback — fontconfig's choice in libass (Poppins for Devanagari, Noto for
# the others), the operating system's in the browser (Nirmala UI on Windows).
# Two different fonts, at two different sizes: libass sizes a fallback by its
# own win span, the browser at the caption font's em. Naming one vendored file
# for each script, in both renderers, and sizing it to the caption font's em,
# makes them agree. The files are in frontend/public/fonts, identical to the
# image's fonts-noto-core; globals.css gives the browser the same ones,
# limited to each script's characters with unicode-range.
SCRIPT_FONTS: tuple[tuple[str, str], ...] = (
    ("Noto Sans Devanagari", "\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF"),
    ("Noto Sans Bengali", "\u0980-\u09FF"),
    ("Noto Sans Tamil", "\u0B80-\u0BFF"),
    ("Noto Sans Malayalam", "\u0D00-\u0D7F"),
)


# Cyrillic (Russian) the same way, but only for a caption font that has none:
# Poppins (the default), Anton, Bebas Neue and Barlow Condensed don't, while
# Lato, Liberation and DejaVu do and keep drawing it themselves.
CYRILLIC_FONT: tuple[str, str] = ("Noto Sans", "\u0400-\u052F")


def script_fonts(key: str, bold: bool) -> tuple[tuple[str, str], ...]:
    """The script faces to use for this caption font, in both renderers."""
    if covers(key, bold, 0x0416):  # Ж
        return SCRIPT_FONTS
    return (*SCRIPT_FONTS, CYRILLIC_FONT)


def font_file(key: str, bold: bool, italic: bool = False) -> Path | None:
    """The file libass will draw this caption font from."""
    if key not in FONTS_BY_KEY:
        weight = "bold" if bold else "regular"
        for path in (font_library.cached_path(key, weight), font_library.cached_path(key, "regular")):
            if path.exists():
                return path
        return None
    path = _fc_match(get_font(key).render_name, bold, italic)
    return Path(path) if path else None


def script_font_file(family: str, bold: bool) -> Path | None:
    """The file libass draws a script face from."""
    path = _fc_match(family, bold)
    return Path(path) if path else None


@lru_cache(maxsize=128)
def _charset(path: Path) -> tuple[tuple[int, int], ...]:
    """The code points a font file covers, as fontconfig reads them."""
    try:
        out = subprocess.run(
            ["fc-query", "--format", "%{charset}", str(path)],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return ()
    ranges = []
    for part in out.split():
        lo, _, hi = part.partition("-")
        try:
            ranges.append((int(lo, 16), int(hi or lo, 16)))
        except ValueError:
            continue
    return tuple(ranges)


def covers(key: str, bold: bool, codepoint: int) -> bool:
    """Whether the caption font itself has a glyph for `codepoint`."""
    path = font_file(key, bold)
    return path is not None and any(lo <= codepoint <= hi for lo, hi in _charset(path))


def script_font_span(family: str, bold: bool) -> float:
    """The win span of a script font, for sizing it to the caption font's em."""
    return _installed_span(family, bold) or 1.0


@lru_cache(maxsize=64)
def _fc_match(family: str, bold: bool, italic: bool = False) -> str | None:
    """The file fontconfig hands libass for this family, weight and slant."""
    slant = ":slant=100" if italic else ""
    try:
        return subprocess.run(
            ["fc-match", "-f", "%{file}", f"{family}:weight={200 if bold else 80}{slant}"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


@lru_cache(maxsize=64)
def _installed_span(render_name: str, bold: bool) -> float | None:
    """The win span of the face fontconfig hands libass for this family."""
    path = _fc_match(render_name, bold)
    return font_library.span_of(Path(path)) if path else None


def font_win_span(key: str, bold: bool) -> float:
    """
    How much taller than its em square libass draws this font.

    libass sizes a face the way GDI did: the requested Fontsize is the height
    of the font's whole cell, usWinAscent + usWinDescent, not its em. CSS
    `font-size` is the em. So the same number drew Poppins (span 1.4) 40%
    larger in the preview than in the export, and Liberation Sans 12% larger —
    the export wrapped in different places and every caption came out smaller
    than it looked. The preview divides by this to draw at libass's em, and
    sets its line height to it, which is libass's line pitch.

    1.0 (no correction) only if the face can't be measured.
    """
    font = get_font(key)
    if key not in FONTS_BY_KEY:
        weight = "bold" if bold else "regular"
        span = font_library.win_span(key, weight) or font_library.win_span(key)
    else:
        span = _installed_span(font.render_name, bold)
    return span or 1.0


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
    # Centred, and back to the default width and line count: a caption
    # dragged or resized by hand would otherwise keep that through a preset.
    "pos_x": 0.5,
    "box_width": None,
    "max_lines": 2,
    "line_style": "balanced",
    "words_per_line": 2,
}

# The box centre's height for the Top / Middle / Bottom placements, as a
# fraction of the frame. Every caption is then slid inside the safe area on its
# own, so a three-line caption at the bottom still clears the edge.
PLACEMENT_Y: dict[str, float] = {"top": 0.12, "middle": 0.5, "bottom": 0.88}

PRESETS: dict[str, dict] = {
    "youtube": {
        **_PRESET_BASELINE,
        # Humanist, quiet, and easy over a long stretch of dialogue — which is
        # what a boxed subtitle at the bottom of a talking-head video is.
        "font_key": "lato",
        "font_size": 48,
        "bold": False,
        "italic": False,
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 0,
        "box_color": "#000000",
        "box_opacity": 0.75,
        "pos_y": PLACEMENT_Y["bottom"],
        "alignment": Alignment.CENTER,
    },
    "tiktok": {
        **_PRESET_BASELINE,
        # A black display face is most of this look, and the one part a size or
        # colour cannot approximate.
        "font_key": "anton",
        "font_size": 64,
        # Not bold: Anton is already black, and it ships as a single weight, so
        # both renderers would synthesise a fake bold on top of it. They would
        # agree — that is why the @font-face declares 400 only — but agreeing
        # on a smeared outline is not the same as looking right.
        "bold": False,
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
        "pos_y": PLACEMENT_Y["middle"],
        "alignment": Alignment.CENTER,
    },
    "minimal": {
        **_PRESET_BASELINE,
        "font_key": "poppins",
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
        "pos_y": PLACEMENT_Y["bottom"],
        "alignment": Alignment.CENTER,
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

    A nullable column with no default defaults to NULL, and is included as
    None. Leaving those out is how a reset (and, through the preset test,
    every preset) kept a hand-dragged `pos_x`/`pos_y`: SQLAlchemy records
    `default=None` as no default at all.
    """
    skip = {"id", "video_id", "created_at", "updated_at"}
    return {
        column.name: column.default.arg if column.default is not None else None
        for column in CaptionStyle.__table__.columns
        if column.name not in skip and (column.default is not None or column.nullable)
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


# The middle row of ASS's numeric-keypad alignments: every caption is placed
# with `\pos` (caption_layout), at the vertical centre of its lines.
#
# `\an` does two jobs at once: it says which point of the text `\pos`
# refers to, *and* how the lines are justified against each other. So the
# horizontal half follows the caption's alignment, and the layout hands `\pos`
# the lines' left edge, centre or right edge to match.
_ASS_ALIGNMENT = {
    Alignment.LEFT: 4,
    Alignment.CENTER: 5,
    Alignment.RIGHT: 6,
}


def to_ass_alignment(style: CaptionStyle) -> int:
    """The `\\an` to pair with `\\pos`."""
    return _ASS_ALIGNMENT[style.alignment]


def box_pad(style: CaptionStyle, height: int) -> int:
    """The box padding, or the outline width, in frame pixels."""
    scale = scale_for(height)
    if style.box_opacity > 0:
        return round(style.box_padding * scale)
    return round(style.outline_width * scale)


def to_ass_style(style: CaptionStyle, height: int) -> dict[str, str | int]:
    """
    The fields of an ASS `Style:` line, as a dict.

    A dict rather than a formatted string so the values can be asserted
    individually in tests. Use `to_ass_style_block` to serialise it — the
    ordering is not something a caller should redo.

    Always BorderStyle 1. A box is not libass's BorderStyle 3: that boxes each
    run of text separately, and a caption whose Hindi words are each named
    in their script font (`subtitles._script_runs`) burned as a row of
    overlapping translucent boxes, darker where they overlapped. The box is
    drawn instead, as a shape of the layout's exact rectangle under the text
    (`subtitles._box_event`) — the rectangle the preview paints.
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
        # The drop-shadow colour at BorderStyle 1. Getting this wrong is
        # invisible rather than loud: ASS alpha is *transparency*, so a box
        # colour at box_opacity 0 here would draw the shadow fully invisible.
        "BackColour": to_ass_colour(style.shadow_color),
        "BorderStyle": 1,
        # A box replaces the outline and the shadow, in the preview too.
        "Outline": 0 if boxed else box_pad(style, height),
        "Shadow": 0 if boxed else round(style.shadow * scale),
        "Spacing": round(style.letter_spacing * scale),
        # Every event carries its own `\an`, `\pos` and line breaks from the
        # layout, so the margins have nothing left to do.
        "Alignment": to_ass_alignment(style),
        "MarginL": 0,
        "MarginR": 0,
        "MarginV": 0,
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
