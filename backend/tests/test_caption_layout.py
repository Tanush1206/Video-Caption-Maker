"""
The caption layout rule (services/caption_layout.py) and what libass draws
from it.

The editor runs the same rule (frontend/src/lib/caption-layout.ts); the
browser half is checked by scripts/ui-check (`caption-safe-area`,
`caption-width`, `layout-parity`).
"""

import itertools
import subprocess

import numpy as np
import pytest

from app.models.caption import Caption
from app.models.caption_style import Alignment
from app.services import caption_layout, rendering, subtitles
from app.services.caption_layout import SAFE_AREA, layout_caption, wrap
from tests.conftest import a_style

ASPECTS = {"16:9": (640, 360), "9:16": (360, 640), "1:1": (480, 480)}

TEXTS = {
    "short": "Hi there",
    "long": (
        "Finally, stir everything together until the soup is completely smooth, then serve "
        "it hot with fresh bread, a little butter and a handful of chopped herbs on top"
    ),
    "hindi": "अंत में, सब कुछ चिकना होने तक मिलाएँ और इसे ताज़ी रोटी के साथ परोसें",
    "german": (
        "Donaudampfschifffahrtsgesellschaftskapitän und "
        "Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz"
    ),
    "russian": "Наконец, перемешайте все, пока оно не будет гладким, и подайте его с хлебом",
}

# Corners, edge centres, the centre, and far outside the frame on each side.
# The API keeps a saved centre inside 0..1; the layout takes anything, which
# is what a drag past the edge hands it before the clamp.
POSITIONS = [
    (0, 0), (1, 0), (0, 1), (1, 1),
    (0.5, 0), (1, 0.5), (0.5, 1), (0, 0.5),
    (0.5, 0.5),
    (-0.5, 0.5), (1.5, 0.5), (0.5, -0.5), (0.5, 1.5),
]

LOOKS = {
    "box-pad-0": dict(box_opacity=1.0, box_padding=0, outline_width=0, shadow=0),
    "box-pad-40": dict(box_opacity=1.0, box_padding=40, outline_width=0, shadow=0),
    "outline-shadow": dict(box_opacity=0.0, outline_width=8, shadow=8),
}
SIZES = {"small": 28, "large": 110}


def _style(look: str, size: str, **overrides):
    return a_style(
        **{
            "font_key": "poppins", "bold": True, "font_size": SIZES[size],
            "text_color": "#FFFFFF", "outline_color": "#000000", "shadow_color": "#000000",
            "box_color": "#000000", **LOOKS[look], **overrides,
        }
    )


def _inside_safe_area(rect, width, height, slack=1e-6):
    x, y, w, h = rect
    return (
        x >= SAFE_AREA * width - slack
        and y >= SAFE_AREA * height - slack
        and x + w <= (1 - SAFE_AREA) * width + slack
        and y + h <= (1 - SAFE_AREA) * height + slack
    )


# ── The rule ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("aspect", ASPECTS)
@pytest.mark.parametrize("look", LOOKS)
@pytest.mark.parametrize("size", SIZES)
def test_every_caption_is_inside_the_safe_area(aspect, look, size):
    """
    Whatever the position, shape, text, padding or size, everything the
    caption paints — lines, padding or outline, shadow — is inside 3% of
    every edge. Each text is a different size, so each is checked.
    """
    width, height = ASPECTS[aspect]
    for (name, text), (x, y) in itertools.product(TEXTS.items(), POSITIONS):
        layout = layout_caption(text, _style(look, size, pos_x=x, pos_y=y), width, height)
        assert _inside_safe_area(layout.ink, width, height), (name, x, y, layout.ink)


@pytest.mark.parametrize("aspect", ASPECTS)
def test_dragging_never_changes_the_width_or_the_lines(aspect):
    """
    The box keeps its lines and size from the centre to any edge and past it:
    it slides, it doesn't shrink or rewrap. Before, its width was the space
    left to the edge, and at the right it wrapped to one word per line.
    """
    width, height = ASPECTS[aspect]
    for text in TEXTS.values():
        centred = layout_caption(text, _style("box-pad-40", "small", pos_x=0.5, pos_y=0.5), width, height)
        for x, y in POSITIONS:
            moved = layout_caption(text, _style("box-pad-40", "small", pos_x=x, pos_y=y), width, height)
            assert moved.text == centred.text, (x, y)
            assert (moved.width, moved.height, moved.size) == (centred.width, centred.height, centred.size)


def test_text_wraps_at_the_box_width_not_the_frame():
    """A narrower box means more lines; no line is wider than the box."""
    text = TEXTS["long"]
    lines = {}
    for box_width in (0.3, 0.5, 0.8):
        style = _style("box-pad-40", "small", box_width=box_width, max_lines=3)
        layout = layout_caption(text, style, 1920, 1080)
        assert layout.width <= box_width * 1920 + 1e-6, box_width
        lines[box_width] = len(layout.lines)
    assert lines[0.3] > lines[0.5] > lines[0.8]


def test_the_default_width_follows_the_frames_shape():
    style = _style("box-pad-0", "small", box_width=None)
    assert caption_layout.box_width_of(style, 1920, 1080) == 0.80
    assert caption_layout.box_width_of(style, 1080, 1080) == 0.80
    assert caption_layout.box_width_of(style, 1080, 1920) == 0.85


@pytest.mark.parametrize("max_lines", [1, 2, 3])
def test_the_font_shrinks_to_keep_to_max_lines(max_lines):
    """
    More lines than allowed at the chosen size: the font shrinks, by 2% steps
    and no further than 70%, until it fits.
    """
    text = "Stir everything together until it is smooth and then serve it warm"
    style = _style("box-pad-0", "small", font_size=60, box_width=0.5, max_lines=max_lines)
    full = wrap(text, 0.5 * 1920, lambda s: len(s) * 1000)  # sanity: wrap works
    assert full
    layout = layout_caption(text, style, 1920, 1080)
    assert len(layout.lines) <= max_lines
    assert 0.7 <= layout.shrink <= 1.0
    unshrunk = layout_caption(text, _style("box-pad-0", "small", font_size=60, box_width=0.5, max_lines=3), 1920, 1080)
    if len(unshrunk.lines) > max_lines:
        assert layout.shrink < 1.0


def test_one_extra_line_rather_than_cutting_text():
    """
    Too long for max_lines even at 70%: one more line, at the largest size
    that fits in it — and whatever happens, every word is still there.
    """
    text = "Stir everything together until it is smooth and then serve it warm with fresh bread"
    style = _style("box-pad-0", "large", max_lines=1)
    at_70 = layout_caption(text, _style("box-pad-0", "large", max_lines=3, font_size=77), 1920, 1080)
    assert len(at_70.lines) > 1, "the text must not fit one line even at 70%"
    layout = layout_caption(text, style, 1920, 1080)
    assert len(layout.lines) == 2
    assert " ".join(layout.text).split() == text.split()
    # The largest size that fits two lines, not 70%.
    assert layout.shrink == 1.0

    huge = layout_caption(" ".join([TEXTS["long"]] * 4), style, 1920, 1080)
    assert huge.shrink == 0.7
    assert " ".join(huge.text).split() == (" ".join([TEXTS["long"]] * 4)).split()


def test_a_word_wider_than_the_box_is_broken():
    """Never wider than the box, and every letter kept, in order."""
    word = "Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz"
    style = _style("box-pad-40", "large", box_width=0.2)
    layout = layout_caption(word, style, 1920, 1080)
    assert len(layout.lines) > 1
    assert "".join(layout.text) == word
    assert all(line.width <= 0.2 * 1920 - 2 * layout.pad + 1e-6 for line in layout.lines)


def test_a_broken_word_keeps_its_clusters():
    """Not before a vowel sign or other mark, not after a virama or a joiner."""
    word = "क्षत्रियोंकीप्रतिष्ठा" * 3
    style = _style("box-pad-0", "large", box_width=0.2)
    layout = layout_caption(word, style, 1920, 1080)
    assert len(layout.lines) > 1
    for line in layout.text[1:]:
        assert line[0] not in "्ािीुूेैोौंँ"
    for line in layout.text[:-1]:
        assert line[-1] != "्"


def test_alignment_sets_the_lines_against_the_box():
    """Left-aligned text starts at the box's left edge; right ends at its right."""
    width = 1920
    for alignment, expect in ((Alignment.LEFT, "left"), (Alignment.RIGHT, "right"), (Alignment.CENTER, "centre")):
        style = _style("box-pad-0", "small", alignment=alignment, pos_x=0.5, pos_y=0.5, box_width=0.6)
        layout = layout_caption("Hi there", style, width, 1080)
        box_left, box_right = 0.5 * width - 0.3 * width, 0.5 * width + 0.3 * width
        if expect == "left":
            assert layout.x == pytest.approx(box_left)
        elif expect == "right":
            assert layout.x + layout.width == pytest.approx(box_right)
        else:
            assert layout.x + layout.width / 2 == pytest.approx(0.5 * width)


# ── What libass draws from it ────────────────────────────────────────────


def _burn(captions, style, width, height, tmp_path):
    """Every caption burned on a grey frame of its own, as rgb arrays."""
    ass = tmp_path / "grid.ass"
    ass.write_text(subtitles.to_ass(captions, style, width, height), encoding="utf-8")
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=0x808080:s={width}x{height}:r=1:d={len(captions)}",
            "-vf", rendering._filter_chain(ass, None),
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        capture_output=True, timeout=300, check=True,
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(len(captions), height, width, 3)


def _painted(frame):
    """The bounding box of everything that isn't the grey background."""
    mask = np.any(np.abs(frame.astype(int) - 128) > 24, axis=2)
    rows, cols = np.nonzero(mask)
    if rows.size == 0:
        return None
    return cols.min(), rows.min(), cols.max() + 1, rows.max() + 1


@pytest.mark.parametrize("aspect", ASPECTS)
@pytest.mark.parametrize("look", LOOKS)
@pytest.mark.parametrize("size", SIZES)
def test_the_burned_caption_is_inside_the_safe_area_where_the_layout_put_it(
    aspect, look, size, tmp_path
):
    """
    The same grid, burned: each caption's painted pixels are inside the safe
    area, and inside the rectangle the layout (and so the editor) gave it —
    a box fills it to within 2px; outlined text sits inside it.
    """
    width, height = ASPECTS[aspect]
    lo_x, hi_x = SAFE_AREA * width, (1 - SAFE_AREA) * width
    lo_y, hi_y = SAFE_AREA * height, (1 - SAFE_AREA) * height
    for x, y in POSITIONS:
        # One burn per position: each text a caption of its own, a second apart.
        style = _style(look, size, pos_x=x, pos_y=y)
        captions = [
            Caption(video_id=1, sequence=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=text, confidence=-0.1)
            for i, text in enumerate(TEXTS.values())
        ]
        burned = _burn(captions, style, width, height, tmp_path)
        for name, frame, caption in zip(TEXTS, burned, captions):
            case = (name, x, y)
            box = _painted(frame)
            assert box is not None, case
            x0, y0, x1, y1 = box
            # Pixel edges: a box edge at 19.2 lights pixel 19.
            assert x0 >= int(lo_x) and y0 >= int(lo_y) and x1 <= hi_x + 1 and y1 <= hi_y + 1, (case, box)
            lx, ly, lw, lh = layout_caption(caption.text, style, width, height).ink
            # Inside what the layout says it paints (its rectangle, shadow and
            # bleed) — and for a box, no more than the bleed short of it.
            assert x0 >= lx and y0 >= ly and x1 <= lx + lw + 1 and y1 <= ly + lh + 1, (
                case, box, (lx, ly, lw, lh),
            )
            if look.startswith("box"):
                rect = layout_caption(caption.text, style, width, height)
                # libass boxes each glyph, and a Devanagari box came out 0.8%
                # wider than the advances HarfBuzz gives the layout.
                slack = max(2.5, 0.01 * rect.width)
                assert abs(x0 - rect.x) <= slack and abs(x1 - (rect.x + rect.width)) <= slack, (case, box)
                assert abs(y0 - rect.y) <= 2.5 and abs(y1 - (rect.y + rect.height)) <= 2.5, (case, box)


def test_a_translucent_box_is_one_even_rectangle(tmp_path):
    """
    A boxed Hindi caption burns as one box of one level, not a row of
    overlapping boxes. libass's BorderStyle 3 boxed each font run, and each
    Hindi word is a run of its own (its script font), so a 60% box came out
    darker wherever two words' boxes overlapped.
    """
    style = _style(
        "box-pad-40", "large", pos_x=0.5, pos_y=0.5,
        box_color="#FFFFFF", box_opacity=0.6, text_color="#000000",
    )
    captions = [Caption(video_id=1, sequence=0, start_ms=0, end_ms=900, text=TEXTS["hindi"], confidence=-0.1)]
    frame = _burn(captions, style, 1280, 720, tmp_path)[0].astype(int)
    layout = layout_caption(TEXTS["hindi"], style, 1280, 720)
    x0, y0 = int(layout.x) + 3, int(layout.y) + 3
    inside = frame[y0:int(layout.y + layout.height) - 3, x0:int(layout.x + layout.width) - 3].mean(axis=2)
    # Box pixels: everything but the (black) text and its antialiasing.
    box = inside[inside > 160]
    assert box.size > 0.5 * inside.size
    assert box.max() - np.median(box) <= 6, f"box levels {np.median(box):.0f} to {box.max():.0f}"
