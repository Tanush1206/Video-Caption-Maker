"""Remember the spoken and caption language chosen for a video.

Revision ID: f1c93d05a827
Revises: e5b2c8a41f37
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f1c93d05a827"
down_revision: Union[str, None] = "e5b2c8a41f37"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server defaults, not just ORM ones: existing rows need a value now, and
    # the values chosen are exactly what those rows already did — auto-detect
    # the language, and leave the captions in it. So this migration changes no
    # behaviour for anything already transcribed.
    op.add_column(
        "videos",
        sa.Column("spoken_language", sa.String(16), nullable=False, server_default="auto"),
    )
    op.add_column(
        "videos",
        sa.Column("caption_language", sa.String(16), nullable=False, server_default="same"),
    )


def downgrade() -> None:
    op.drop_column("videos", "caption_language")
    op.drop_column("videos", "spoken_language")
