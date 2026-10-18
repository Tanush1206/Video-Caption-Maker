"""Videos keep the word timings their captions were made from.

Revision ID: a4d8e2c6f130
Revises: f7c1d2e8a940

Nullable; existing videos have none until their next transcription.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a4d8e2c6f130"
down_revision: Union[str, None] = "f7c1d2e8a940"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("speech", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "speech")
