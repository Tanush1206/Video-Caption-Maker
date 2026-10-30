"""Existing videos keep the caption style they had.

Revision ID: c3e7a9d15b42
Revises: a6d2f0c8b913

v1.3.0 changes the default style (Poppins Bold 54, outline 3, no shadow ->
100, 6, 3) and a video with no `caption_styles` row is burned with the
default: an existing video nobody had restyled would change on its next
export. Each one gets a row of the old default, so it doesn't; new videos
and Reset get the new one. Rows saved before are not touched.

The downgrade leaves the rows: under the old code they are the default
anyway, so they change nothing.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3e7a9d15b42"
down_revision: Union[str, None] = "a6d2f0c8b913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The default before v1.3.0, copied: a migration must keep meaning what it
# meant when it was written. Landscape and portrait alike, as it was.
OLD_DEFAULT = """
    'poppins', 54, true, false, '#FFFFFF', '#000000', 3, '#000000', 0.0,
    'center', 0, '#000000', false, false, 0, false, 8, 0.5, 0.88, NULL, 2,
    'balanced', 2
"""


def freeze(bind) -> int:
    """A row of the old default for every video without one; returns how many."""
    result = bind.execute(sa.text(f"""
        INSERT INTO caption_styles (
            video_id, font_key, font_size, bold, italic, text_color, outline_color,
            outline_width, box_color, box_opacity, alignment, shadow, shadow_color,
            underline, strikeout, letter_spacing, uppercase, box_padding, pos_x,
            pos_y, box_width, max_lines, line_style, words_per_line
        )
        SELECT v.id, {OLD_DEFAULT}
        FROM videos v
        WHERE NOT EXISTS (SELECT 1 FROM caption_styles s WHERE s.video_id = v.id)
    """))
    return result.rowcount


def upgrade() -> None:
    freeze(op.get_bind())


def downgrade() -> None:
    pass
