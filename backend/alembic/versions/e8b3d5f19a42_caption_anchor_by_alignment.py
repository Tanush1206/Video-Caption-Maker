"""A caption's position is its anchor by alignment, not the wrap box's centre.

Revision ID: e8b3d5f19a42
Revises: b6e0f4a9c2d1

Until v1.2.0 `pos_x` was the centre of a box `box_width` wide, and Left/Right
lines sat against that box's edges: changing alignment threw the caption
across the frame. Now `pos_x` is the anchor of the caption's own block: its
left edge (Left), centre (Centre) or right edge (Right) (services/caption_layout.py).

Left and Right rows get the old box's left or right edge, which is exactly
where their lines started or ended: every caption burns as before, to the
byte (tests/test_caption_anchor.py). Centre rows don't change; the two rules
agree for them.

A NULL `box_width` is the default for the frame's shape, so those rows need
the video's frame size: read from its file, as the burn reads it. A file that
can't be read is taken as landscape, as c8f2a6d41e93 did.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e8b3d5f19a42"
down_revision: Union[str, None] = "b6e0f4a9c2d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# caption_layout.DEFAULT_WIDTH_LANDSCAPE / _PORTRAIT, copied: a migration must
# keep meaning what it meant when it was written.
_LANDSCAPE = 0.80
_PORTRAIT = 0.85


def _clamp(value: float) -> float:
    # The API keeps a position inside 0..1. A Left anchor past the frame's
    # left edge (or Right past its right) burns the same at 0 (or 1): either
    # way the caption is slid to the safe area's edge.
    return min(1.0, max(0.0, value))


def anchor(pos_x: float, alignment: str, width: float) -> float:
    """The old box centre as the new anchor: that box's left or right edge."""
    if alignment == "left":
        return _clamp(pos_x - width / 2)
    if alignment == "right":
        return _clamp(pos_x + width / 2)
    return pos_x


def centre(pos_x: float, alignment: str, width: float) -> float:
    """The anchor back as a box centre (downgrade)."""
    if alignment == "left":
        return _clamp(pos_x + width / 2)
    if alignment == "right":
        return _clamp(pos_x - width / 2)
    return pos_x


def default_width(storage_path: str | None) -> float:
    """The default box width for a video's frame shape, read from its file."""
    try:
        from app.services import media, storage

        streams = media.inspect(storage.resolve(storage_path)) if storage_path else None
    except Exception:  # noqa: BLE001 — an unreadable file is landscape, as before
        streams = None
    if streams and streams.width and streams.height and streams.height > streams.width:
        return _PORTRAIT
    return _LANDSCAPE


def convert(bind, to_new: bool) -> int:
    """Move every Left/Right style's `pos_x`; returns how many rows changed."""
    rows = bind.execute(
        sa.text(
            "SELECT s.id, s.alignment::text, s.pos_x, s.box_width, v.storage_path"
            " FROM caption_styles s JOIN videos v ON v.id = s.video_id"
            " WHERE s.alignment::text IN ('left', 'right')"
        )
    ).all()
    for style_id, alignment, pos_x, box_width, storage_path in rows:
        width = box_width if box_width is not None else default_width(storage_path)
        moved = anchor(pos_x, alignment, width) if to_new else centre(pos_x, alignment, width)
        bind.execute(
            sa.text("UPDATE caption_styles SET pos_x = :x WHERE id = :id"),
            {"x": moved, "id": style_id},
        )
    return len(rows)


def upgrade() -> None:
    convert(op.get_bind(), to_new=True)


def downgrade() -> None:
    convert(op.get_bind(), to_new=False)
