"""
A caption's position is its anchor by alignment (v1.2.0): the left edge of
its block on Left, its centre on Centre, its right edge on Right. Changing
alignment, done in the editor, saves the anchor that keeps the caption on
screen where it is; the layout and the burn then put the block there.

The editor runs the same rule (frontend/src/lib/caption-layout.ts); the
browser half is checked by scripts/ui-check `alignment-anchor` and
`layout-parity`.
"""

import importlib.util
import json
import subprocess
from pathlib import Path

import numpy as np
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.caption_style import Alignment, CaptionStyle
from app.services import storage, subtitles
from app.services.caption_layout import SAFE_AREA, anchor_of, default_width, layout_caption
from app.services.caption_style import default_style_fields
from tests.conftest import a_style
from tests.test_caption_layout import _burn

ROOT = Path(__file__).parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


migration = _load("anchor_migration", ROOT / "alembic/versions/e8b3d5f19a42_caption_anchor_by_alignment.py")
reference = _load("burn_reference", ROOT / "scripts/burn_reference.py")

ALIGNMENTS = (Alignment.LEFT, Alignment.CENTER, Alignment.RIGHT)
# Against the left edge, the middle, against the right edge.
PLACES = {"left edge": 0.0, "centre": 0.5, "right edge": 1.0}
WIDTHS = (0.2, 0.5, 0.8, 0.94)  # 0.94 is the most the API takes: the safe area's width
TEXTS = [
    "Hi there",
    "ko auto generate karegi aur",
    "Finally, stir everything together until the soup is completely smooth, then serve it hot",
]


def _style(**overrides):
    return a_style(**{
        "font_key": "poppins", "bold": True, "font_size": 54, "pos_y": 0.8,
        "box_opacity": 1.0, "box_padding": 12, "box_color": "#FF0000",
        "outline_width": 0, "shadow": 0, **overrides,
    })


def _realigned(text, style, alignment, width, height):
    """What the editor saves on an alignment change: the same block, a new anchor."""
    shown = layout_caption(text, style, width, height)
    return _style(**{
        **{k: getattr(style, k) for k in ("pos_x", "pos_y", "box_width", "font_size")},
        "alignment": alignment,
        "pos_x": anchor_of(shown.x, shown.width, alignment) / width,
    })


# ── Changing alignment never moves the caption ───────────────────────────


@pytest.mark.parametrize("place", PLACES)
@pytest.mark.parametrize("box_width", WIDTHS)
def test_changing_alignment_keeps_the_block_where_it_is(place, box_width):
    width, height = 1920, 1080
    for text in TEXTS:
        for before in ALIGNMENTS:
            style = _style(alignment=before, pos_x=PLACES[place], box_width=box_width)
            shown = layout_caption(text, style, width, height)
            for after in ALIGNMENTS:
                moved = layout_caption(text, _realigned(text, style, after, width, height), width, height)
                assert (moved.x, moved.y, moved.width, moved.height) == pytest.approx(
                    (shown.x, shown.y, shown.width, shown.height), abs=1e-6
                ), (place, box_width, text, before, after)
                assert moved.text == shown.text


@pytest.mark.parametrize("place", PLACES)
def test_changing_alignment_keeps_the_box_where_it_is_in_the_burn(place):
    """The burn's box event, the rectangle the MP4 paints, at every width."""
    width, height = 1280, 720
    for box_width in WIDTHS:
        for before in ALIGNMENTS:
            style = _style(alignment=before, pos_x=PLACES[place], box_width=box_width)
            for after in ALIGNMENTS:
                realigned = _realigned(TEXTS[1], style, after, width, height)
                boxes = [
                    [line.split("}", 1)[1] for line in subtitles.to_ass([_caption(TEXTS[1])], s, width, height)
                     .splitlines() if line.startswith("Dialogue: 0,")]
                    for s in (style, realigned)
                ]
                positions = [
                    [line.split("\\pos(", 1)[1].split(")", 1)[0] for line in subtitles.to_ass(
                        [_caption(TEXTS[1])], s, width, height).splitlines() if line.startswith("Dialogue: 0,")]
                    for s in (style, realigned)
                ]
                assert boxes[0] == boxes[1] and positions[0] == positions[1], (place, box_width, before, after)


@pytest.mark.parametrize("place", PLACES)
def test_changing_alignment_keeps_the_caption_where_it_is_in_the_pixels(place, tmp_path):
    """Burned: the red box covers the same pixels before and after, on each side."""
    width, height = 640, 360

    def box(style):
        frame = _burn([_caption(TEXTS[1])], style, width, height, tmp_path)[0].astype(int)
        red = (frame[..., 0] > 180) & (frame[..., 1] < 80) & (frame[..., 2] < 80)
        rows, cols = np.nonzero(red)
        return rows.min(), rows.max(), cols.min(), cols.max()

    for box_width in (0.2, 0.8):
        style = _style(alignment=Alignment.CENTER, pos_x=PLACES[place], box_width=box_width, font_size=40)
        drawn = box(style)
        for after in (Alignment.LEFT, Alignment.RIGHT):
            assert box(_realigned(TEXTS[1], style, after, width, height)) == drawn, (place, box_width, after)


def _caption(text: str, i: int = 0) -> Caption:
    return Caption(video_id=1, sequence=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=text, confidence=-0.1)


# ── The anchor ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("box_width", (0.2, 0.5, 0.8))
def test_left_captions_share_a_left_edge_and_right_ones_a_right_edge(box_width):
    """Anchors far enough in that no block is slid: each one's edge is the anchor."""
    width, height = 1920, 1080
    for alignment, x in ((Alignment.LEFT, 0.1), (Alignment.RIGHT, 0.9), (Alignment.CENTER, 0.5)):
        style = _style(alignment=alignment, pos_x=x, box_width=box_width)
        blocks = [layout_caption(t, style, width, height) for t in TEXTS]
        assert len({round(b.width) for b in blocks}) > 1, "the texts should differ in width"
        if alignment == Alignment.LEFT:
            edges = [b.x for b in blocks]
        elif alignment == Alignment.RIGHT:
            edges = [b.x + b.width for b in blocks]
        else:
            edges = [b.x + b.width / 2 for b in blocks]
        assert edges == pytest.approx([x * width] * len(TEXTS), abs=1e-6), (alignment, box_width)


def test_the_block_is_only_as_wide_as_its_longest_line():
    """Max width only limits a line: a short caption's block is short."""
    style = _style(alignment=Alignment.LEFT, pos_x=0.1, box_width=0.94)
    short = layout_caption("Hi there", style, 1920, 1080)
    assert short.width == pytest.approx(max(line.width for line in short.lines) + 2 * short.pad)
    assert short.width < 0.2 * 1920


@pytest.mark.parametrize("alignment", ALIGNMENTS)
@pytest.mark.parametrize("box_width", WIDTHS)
def test_the_clamp_keeps_every_block_inside_the_safe_area(alignment, box_width):
    """At each edge and past it, every caption on its own, for each alignment."""
    for width, height in ((1920, 1080), (1080, 1920), (720, 720)):
        for x in (-0.5, 0.0, 0.03, 0.5, 0.97, 1.0, 1.5):
            for y in (0.0, 1.0):
                style = _style(alignment=alignment, pos_x=x, pos_y=y, box_width=box_width)
                for text in TEXTS:
                    left, top, w, h = layout_caption(text, style, width, height).ink
                    assert left >= SAFE_AREA * width - 1e-6, (alignment, box_width, x, text)
                    assert left + w <= (1 - SAFE_AREA) * width + 1e-6, (alignment, box_width, x, text)
                    assert top >= SAFE_AREA * height - 1e-6 and top + h <= (1 - SAFE_AREA) * height + 1e-6


# ── Old videos look exactly as they did ──────────────────────────────────


def test_migrated_styles_burn_byte_for_byte_as_in_1_1_1():
    """
    tests/data/burn-1.1.1.json: Left, Centre and Right styles at five
    positions and four widths (the default among them) on three frame
    shapes, burned by v1.1.1. Each style moved as the migration moves it
    burns every caption exactly the same.
    """
    data = json.loads((ROOT / "tests/data/burn-1.1.1.json").read_text(encoding="utf-8"))
    for name, overrides in data["styles"].items():
        for width, height in data["frames"]:
            box = overrides["box_width"] or default_width(width, height)
            moved = {**overrides, "pos_x": migration.anchor(overrides["pos_x"], overrides["alignment"], box)}
            document = reference.document(moved, width, height)
            assert reference.digest(document) == data["documents"][f"{name}@{width}x{height}"], (
                f"{name}@{width}x{height}"
            )


def test_the_migration_round_trips():
    for alignment in ("left", "center", "right"):
        for x in (0.1, 0.4, 0.5, 0.6, 0.9):
            for width in (0.2, 0.5, 0.8):
                there = migration.anchor(x, alignment, width)
                if 0 < there < 1:
                    assert migration.centre(there, alignment, width) == pytest.approx(x)


@pytest.mark.asyncio
async def test_the_migration_moves_left_and_right_rows_by_their_frame(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """
    Each Left/Right row moves by half its width; a default width is the one
    for its video's shape, read from the file (85% portrait, 80% landscape).
    Centre rows stay put.
    """
    from app.models.video import Video

    portrait = tmp_path / "portrait.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=360x640:d=1:r=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(portrait)],
        capture_output=True, timeout=120, check=True,
    )
    cases = [
        # (frame, alignment, pos_x, box_width, expected pos_x)
        ("landscape", "left", 0.5, None, 0.1),
        ("portrait", "right", 0.5, None, 0.925),
        ("landscape", "left", 0.6, 0.5, 0.35),
        ("landscape", "right", 0.9, 0.5, 1.0),
        ("landscape", "center", 0.3, None, 0.3),
    ]
    ids = []
    for frame, alignment, x, box_width, _ in cases:
        video_id = (
            await client.post(
                "/api/videos", headers=auth_headers,
                files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
            )
        ).json()["id"]
        async with AsyncSessionLocal() as session:
            if frame == "portrait":
                video = (await session.execute(select(Video).where(Video.id == video_id))).scalar_one()
                storage.resolve(video.storage_path).write_bytes(portrait.read_bytes())
            session.add(CaptionStyle(**{
                **default_style_fields(), "video_id": video_id,
                "alignment": alignment, "pos_x": x, "box_width": box_width,
            }))
            await session.commit()
        ids.append(video_id)

    async with AsyncSessionLocal() as session:
        await session.run_sync(lambda s: migration.convert(s.connection(), to_new=True))
        await session.commit()
        moved = {
            row.video_id: row.pos_x
            for row in (await session.execute(select(CaptionStyle).where(CaptionStyle.video_id.in_(ids)))).scalars()
        }
    for video_id, (frame, alignment, x, box_width, expected) in zip(ids, cases):
        assert moved[video_id] == pytest.approx(expected), (frame, alignment, x, box_width)
