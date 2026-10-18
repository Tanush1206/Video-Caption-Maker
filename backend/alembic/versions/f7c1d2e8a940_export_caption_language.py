"""Exports record the captions they were made from: language and set.

Revision ID: f7c1d2e8a940
Revises: e3a9c71f5b28

Nullable, and left null on existing rows: which captions an old export was
made from wasn't recorded, and guessing would label a file wrongly, which is
the bug this fixes (an English SRT listed after a Redo into Hindi was taken
for the Hindi one).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f7c1d2e8a940"
down_revision: Union[str, None] = "e3a9c71f5b28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exports", sa.Column("caption_language", sa.String(length=16), nullable=True))
    op.add_column("exports", sa.Column("captions_from", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("exports", "captions_from")
    op.drop_column("exports", "caption_language")
