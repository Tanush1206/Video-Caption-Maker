"""Free caption placement: an optional x/y fraction alongside the anchor.

Revision ID: d7a4e91b6c05
Revises: c3f81a5d67e2
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d7a4e91b6c05"
down_revision: Union[str, None] = "c3f81a5d67e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable with no server default, deliberately.
    #
    # NULL is not "unknown" here, it is a mode: the caption is placed by
    # `position`/`alignment` and the margins, which is what every existing row
    # means and what the ASS Style line expresses directly. Defaulting these to
    # 0.5 would silently convert every style in the database to a hand-placed
    # one centred on the frame, which is both a visible move and a lie about
    # what the user chose.
    op.add_column("caption_styles", sa.Column("pos_x", sa.Float(), nullable=True))
    op.add_column("caption_styles", sa.Column("pos_y", sa.Float(), nullable=True))


def downgrade() -> None:
    # Hand-placed captions fall back to their anchor, which is still stored and
    # still valid — the placement is lost, the style is not.
    op.drop_column("caption_styles", "pos_y")
    op.drop_column("caption_styles", "pos_x")
