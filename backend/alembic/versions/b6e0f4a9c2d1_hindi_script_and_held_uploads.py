"""How Hindi captions are written, and uploads held for the language step.

Revision ID: b6e0f4a9c2d1
Revises: a4d8e2c6f130
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b6e0f4a9c2d1"
down_revision: Union[str, None] = "a4d8e2c6f130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL for every existing video: Hindi in Devanagari, as they were made,
    # until a Redo chooses otherwise. Nothing already captioned changes.
    op.add_column("videos", sa.Column("hindi_script", sa.String(16), nullable=True))
    # What the language step heard, before anything is transcribed.
    op.add_column("videos", sa.Column("detected_language", sa.String(16), nullable=True))
    op.add_column("videos", sa.Column("detected_confidence", sa.Float(), nullable=True))
    # Uploaded but not started: not listed, and swept if never started.
    op.add_column(
        "videos",
        sa.Column("held", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("videos", "held")
    op.drop_column("videos", "detected_confidence")
    op.drop_column("videos", "detected_language")
    op.drop_column("videos", "hindi_script")
