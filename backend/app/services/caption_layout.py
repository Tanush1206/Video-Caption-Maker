"""
Where a caption's lines break, how big it is drawn, and where it sits.

The one layout rule for both renderers. The burn hands libass the lines it
works out here (`\\N`, with WrapStyle 2 so libass never wraps on its own), the
size (`\\fs`) and the position (`\\pos`); the editor runs the same rule in
frontend/src/lib/caption-layout.ts and draws the same lines at the same place.
Two renderers that each wrapped and placed text by their own lights is what
let the preview and the MP4 disagree, so neither does any more.

The model:

  - `box_width` (or the default for the frame's shape) is how wide a line may
    get: text wraps at that width minus its padding, never at its distance to
    an edge, so where the caption is dragged can't change its lines.
  - At most `max_lines` lines: when the text needs more, the font shrinks in
    2% steps, down to 70% of its size. When even that doesn't fit, one more
    line is allowed (at the largest size that fits in it), and past that the
    text keeps every line it needs. Text is never cut.
  - The caption's visible block is only as wide as its longest line (plus
    the padding or outline). `pos_x` is that block's anchor, by alignment:
    its left edge (Left), its centre (Centre) or its right edge (Right), so
    left-aligned captions of every length share one left edge and
    right-aligned ones one right edge. `pos_y` is its vertical centre.
    Alignment otherwise only sets the lines against each other inside the
    block (v1.2.0; before, the lines sat against the edges of the whole
    `box_width` box, so changing alignment moved the caption).
  - The caption's whole painted rectangle — its lines, the box padding or the
    outline, the shadow, and what glyphs and antialiasing paint past those
    (OVERHANG_EM, BLEED_PX) — is then slid inside a safe area 3% in from
    every edge. It moves; it never shrinks or rewraps because of an edge.

Widths come from HarfBuzz on the same font files libass draws with, at a
nominal em and scaled; the browser measures the same strings with canvas.
"""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb

from app.models.caption_style import REFERENCE_HEIGHT, Alignment, CaptionStyle
from app.services.caption_style import (
    box_pad,
    font_file,
    font_win_span,
    script_font_file,
    script_font_span,
    script_fonts,
)

# Fractions of the frame. Both are mirrored in caption-layout.ts.
SAFE_AREA = 0.03
DEFAULT_WIDTH_LANDSCAPE = 0.80
DEFAULT_WIDTH_PORTRAIT = 0.85

# The sizes tried, as fractions of the chosen size: 100%, 98% … 70%. A fixed
# list rather than a search, so the browser and this module try exactly the
# same sizes whatever resolution each is drawing at.
SHRINK_STEPS: tuple[float, ...] = tuple((100 - 2 * i) / 100 for i in range(16))
# Past 70%, only to fit the safe area: a caption taller (or wider) than the
# safe area keeps shrinking in the same steps, down to 10%, until it fits.
FIT_STEPS: tuple[float, ...] = tuple((68 - 2 * i) / 100 for i in range(30))

# What paints past the layout's rectangle, kept inside the safe area too:
# glyphs overhang their advance (Noto's Devanagari by up to ~0.1 em, measured),
# and libass rounds font metrics to whole pixels and antialiases the edges
# (1-2px, measured). In ems, and in pixels of the output frame.
OVERHANG_EM = 0.1
BLEED_PX = 2.0

# Every width is measured at this em and scaled, so a measurement is reused at
# every size and nothing depends on hinting at one particular size.
MEASURE_EM = 100.0

# Viramas: a break straight after one would split a conjunct.
_VIRAMAS = frozenset(
    "्্੍્୍்్್്්ฺ္្"
)
_JOINERS = frozenset("‌‍")


def default_width(frame_width: int, frame_height: int) -> float:
    """The box width for a style that hasn't set one: by the frame's shape."""
    return DEFAULT_WIDTH_PORTRAIT if frame_height > frame_width else DEFAULT_WIDTH_LANDSCAPE


def box_width_of(style: CaptionStyle, frame_width: int, frame_height: int) -> float:
    return style.box_width if style.box_width is not None else default_width(frame_width, frame_height)


@dataclass(frozen=True)
class Segment:
    """A stretch of a line drawn in one font: the caption font or a script face."""

    text: str
    family: str | None  # None: the caption font


@dataclass(frozen=True)
class Line:
    segments: tuple[Segment, ...]
    width: float  # px
    pitch: float  # px: this line's height


@dataclass(frozen=True)
class Layout:
    """One caption, laid out on one frame, in that frame's pixels."""

    lines: tuple[Line, ...]
    # The caption font's size after any shrink, as libass's Fontsize (the
    # font's whole cell), and the fraction of the chosen size that is.
    size: float
    shrink: float
    # Box padding when boxed, the outline when not.
    pad: float
    shadow: float
    # OVERHANG_EM and BLEED_PX, in this frame's pixels.
    bleed: float
    # The lines plus `pad` on every side — the box, or the outlined text.
    x: float
    y: float
    width: float
    height: float
    # Where `pos_x` and `pos_y` ask for, after the clamp: the anchor (the
    # block's left edge, centre or right edge, by alignment), and the
    # block's vertical centre.
    anchor_x: float
    center_y: float

    @property
    def text(self) -> tuple[str, ...]:
        return tuple("".join(s.text for s in line.segments) for line in self.lines)

    @property
    def ink(self) -> tuple[float, float, float, float]:
        """Everything painted: the rectangle, the drop shadow and the bleed."""
        b = self.bleed
        return (self.x - b, self.y - b, self.width + self.shadow + 2 * b, self.height + self.shadow + 2 * b)


def breakable(text: str, index: int) -> bool:
    """Whether a long word may be broken before `text[index]`."""
    char, before = text[index], text[index - 1]
    if unicodedata.category(char).startswith("M") or char in _JOINERS:
        return False
    return before not in _VIRAMAS and before not in _JOINERS


def _units(text: str) -> int:
    """Characters letter-spacing is added after: not marks or joiners."""
    return sum(1 for c in text if not unicodedata.category(c).startswith("M") and c not in _JOINERS)


class Measurer:
    """Widths of strings in one caption style, at MEASURE_EM."""

    def __init__(self, style: CaptionStyle, bold: bool):
        self.primary = font_file(style.font_key, bold, style.italic)
        self.scripts = script_fonts(style.font_key, bold)
        self.bold = bold
        self.primary_span = font_win_span(style.font_key, bold)
        self._cache: dict[str, float] = {}

    def segments(self, text: str) -> tuple[Segment, ...]:
        """Split `text` into script-font words and caption-font stretches."""
        marks: list[str | None] = [None] * len(text)
        for family, chars in self.scripts:
            for match in run_pattern(chars).finditer(text):
                for i in range(match.start(), match.end()):
                    marks[i] = family
        out: list[Segment] = []
        start = 0
        for i in range(1, len(text) + 1):
            if i == len(text) or marks[i] != marks[start]:
                out.append(Segment(text[start:i], marks[start]))
                start = i
        return tuple(out)

    def width(self, text: str) -> float:
        """Advance width at MEASURE_EM, letter-spacing not included."""
        cached = self._cache.get(text)
        if cached is None:
            cached = sum(
                _advance(self._file(s.family), s.text) for s in self.segments(text)
            ) * MEASURE_EM
            self._cache[text] = cached
        return cached

    def span(self, family: str | None) -> float:
        return self.primary_span if family is None else script_font_span(family, self.bold)

    def _file(self, family: str | None) -> Path | None:
        return self.primary if family is None else script_font_file(family, self.bold)


@lru_cache(maxsize=32)
def run_pattern(chars: str) -> re.Pattern:
    """One word of a script: its characters and the joiners that shape them."""
    return re.compile(rf"[{chars}][{chars}‌‍]*")


@lru_cache(maxsize=32)
def _hb_font(path: Path) -> tuple[hb.Font, int]:
    face = hb.Face(hb.Blob.from_file_path(str(path)))
    font = hb.Font(face)
    return font, face.upem


@lru_cache(maxsize=4096)
def _advance(path: Path | None, text: str) -> float:
    """Shaped advance of `text` in em, as libass's HarfBuzz shapes it."""
    if path is None or not text:
        return 0.0
    font, upem = _hb_font(path)
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer)
    return sum(p.x_advance for p in buffer.glyph_positions) / upem


def _chunks(word: str, fits: Callable[[str], bool]) -> list[str]:
    """Break a word too wide for the line at the last allowed point that fits."""
    out: list[str] = []
    while word:
        end = 1
        for i in range(2, len(word) + 1):
            if i < len(word) and not breakable(word, i):
                continue
            if not fits(word[:i]):
                break
            end = i
        # At least one whole cluster, even if it alone is too wide.
        while end < len(word) and not breakable(word, end):
            end += 1
        out.append(word[:end])
        word = word[end:]
    return out


def _greedy(tokens: list[str], fits: Callable[[str], bool]) -> list[str]:
    lines: list[str] = []
    for token in tokens:
        if lines and fits(lines[-1] + " " + token):
            lines[-1] += " " + token
        else:
            lines.append(token)
    return lines


def wrap(
    text: str,
    max_width: float,
    width: Callable[[str], float],
    line_style: str = "balanced",
    words_per_line: int = 2,
) -> list[str]:
    """
    Break `text` into lines no wider than `max_width`.

    Each paragraph (a manual line break starts one) is broken on its own:
      - balanced (the default): greedy first, for the number of lines; then
        the narrowest width that still gives that many, so a two-line caption
        isn't one full line and a word. What every caption did before v1.0.8;
      - auto: each line filled to the box width before the next starts, so
        the last line is often short;
      - stacked: `words_per_line` words a line whatever the width, and only a
        group still too wide for the box is broken by width.
    A word wider than the line is broken at a cluster boundary.
    """
    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        if not words:
            continue

        def fits(s: str, limit: float = max_width) -> bool:
            return width(s) <= limit

        if line_style == "stacked":
            for start in range(0, len(words), words_per_line):
                group = " ".join(words[start:start + words_per_line])
                lines.extend([group] if fits(group) else wrap(group, max_width, width))
            continue
        tokens = [chunk for word in words for chunk in (_chunks(word, fits) if not fits(word) else [word])]
        greedy = _greedy(tokens, fits)
        if len(greedy) > 1 and line_style != "auto":
            lo = max(width(t) for t in tokens)
            hi = max_width
            for _ in range(12):
                mid = (lo + hi) / 2
                if len(_greedy(tokens, lambda s, m=mid: fits(s, m))) <= len(greedy):
                    hi = mid
                else:
                    lo = mid
            greedy = _greedy(tokens, lambda s: fits(s, hi))
        lines.extend(greedy)
    return lines


def layout_caption(
    text: str,
    style: CaptionStyle,
    frame_width: int,
    frame_height: int,
    *,
    override_scale: float | None = None,
    bold: bool | None = None,
    measurer: Measurer | None = None,
    pixel: float = 1.0,
) -> Layout:
    """
    Lay out one caption's text on a frame of this size (see module docstring).

    `pixel` is one pixel of the output frame in this frame's units: 1 for the
    burn, which lays out on the output frame itself.
    """
    bold = style.bold if bold is None else bold
    measure = measurer or Measurer(style, bold)
    k = frame_height / REFERENCE_HEIGHT
    boxed = style.box_opacity > 0
    # The numbers the ASS Style line carries, rounded as it rounds them, so
    # this lays out what libass will draw.
    pad = box_pad(style, frame_height)
    shadow = 0 if boxed else round(style.shadow * k)
    spacing = round(style.letter_spacing * k)
    size = style.font_size * (override_scale or 1) * k
    if style.uppercase:
        text = text.upper()

    box = box_width_of(style, frame_width, frame_height) * frame_width
    line_style = getattr(style, "line_style", None) or "balanced"
    line_style = getattr(line_style, "value", line_style)
    words_per_line = getattr(style, "words_per_line", None) or 2
    safe_w = (1 - 2 * SAFE_AREA) * frame_width
    safe_h = (1 - 2 * SAFE_AREA) * frame_height

    def bleed_at(shrink: float) -> float:
        return OVERHANG_EM * size * shrink / measure.primary_span + BLEED_PX * pixel

    def width_at(shrink: float) -> Callable[[str], float]:
        em = size * shrink / measure.primary_span
        return lambda s: measure.width(s) * em / MEASURE_EM + spacing * _units(s)

    def max_width_at(shrink: float) -> float:
        # The box's width, or less if the box with its outline, shadow and
        # overhang would be wider than the safe area (a box at 94%).
        return max(1.0, min(box, safe_w - shadow - 2 * bleed_at(shrink)) - 2 * pad)

    def lines_at(shrink: float) -> list[str]:
        return wrap(text, max_width_at(shrink), width_at(shrink), line_style, words_per_line)

    def build(shrink: float, texts: list[str]) -> tuple[tuple[Line, ...], float, float]:
        em = size * shrink / measure.primary_span
        width = width_at(shrink)
        lines = tuple(
            Line(
                segments=(segments := measure.segments(t)),
                width=width(t),
                pitch=em * max(measure.span(s.family) for s in segments),
            )
            for t in texts
        )
        rect_w = max((line.width for line in lines), default=0.0) + 2 * pad
        rect_h = sum(line.pitch for line in lines) + 2 * pad
        return lines, rect_w, rect_h

    chosen: tuple[float, list[str]] | None = None
    for allowed in (style.max_lines, style.max_lines + 1):
        for shrink in SHRINK_STEPS:
            texts = lines_at(shrink)
            if len(texts) <= allowed:
                chosen = (shrink, texts)
                break
        if chosen:
            break
    if chosen is None:
        chosen = (SHRINK_STEPS[-1], lines_at(SHRINK_STEPS[-1]))
    shrink, texts = chosen
    lines, rect_w, rect_h = build(shrink, texts)

    # The fit rule: a box taller (or wider) than the safe area keeps shrinking
    # until it fits, so no caption is ever cut off at an edge.
    def too_big(shrink: float, rect_w: float, rect_h: float) -> bool:
        b = bleed_at(shrink)
        return rect_h + shadow + 2 * b > safe_h or rect_w + shadow + 2 * b > safe_w

    for step in FIT_STEPS:
        if not too_big(shrink, rect_w, rect_h):
            break
        shrink, texts = step, lines_at(step)
        lines, rect_w, rect_h = build(shrink, texts)

    bleed = bleed_at(shrink)

    ax = style.pos_x * frame_width
    cy = style.pos_y * frame_height
    ax += _slide(block_left(ax, rect_w, style.alignment) - bleed, rect_w + shadow + 2 * bleed, frame_width)
    cy += _slide(cy - rect_h / 2 - bleed, rect_h + shadow + 2 * bleed, frame_height)

    return Layout(
        lines=lines,
        size=size * shrink,
        shrink=shrink,
        pad=pad,
        shadow=shadow,
        bleed=bleed,
        x=block_left(ax, rect_w, style.alignment),
        y=cy - rect_h / 2,
        width=rect_w,
        height=rect_h,
        anchor_x=ax,
        center_y=cy,
    )


def block_left(anchor: float, width: float, alignment: Alignment) -> float:
    """The left edge of a block `width` wide whose anchor is at `anchor`."""
    if alignment == Alignment.LEFT:
        return anchor
    if alignment == Alignment.RIGHT:
        return anchor - width
    return anchor - width / 2


def anchor_of(left: float, width: float, alignment: Alignment) -> float:
    """
    Where a block's anchor is for this alignment: what the editor saves when
    alignment changes, so the caption on screen stays exactly where it is.
    """
    if alignment == Alignment.LEFT:
        return left
    if alignment == Alignment.RIGHT:
        return left + width
    return left + width / 2


def _slide(start: float, extent: float, frame: float) -> float:
    """How far to move a span [start, start + extent] to sit inside the safe area."""
    lo, hi = SAFE_AREA * frame, (1 - SAFE_AREA) * frame
    if extent > hi - lo:
        # Bigger than the safe area: centred on the frame, the least-wrong place.
        return (frame - extent) / 2 - start
    if start < lo:
        return lo - start
    if start + extent > hi:
        return hi - (start + extent)
    return 0.0
