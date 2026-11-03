"""How Hinglish captions are spelled: everyday or formal.

Revision ID: f6b1d8e3a925
Revises: e5a9c3d7f2b8

`videos.hinglish_spelling` (v1.3.1): `everyday` (pehle, liye) or `formal`
(pahle, lie, Apex's own). Nullable and left NULL on every existing row:
their captions were made before the choice existed, in Apex's spelling, and
stay as they are until a Redo.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f6b1d8e3a925"
down_revision: Union[str, None] = "e5a9c3d7f2b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("hinglish_spelling", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "hinglish_spelling")
