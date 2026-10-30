"""Record the quality a burn was rendered at.

Revision ID: a6d2f0c8b913
Revises: e8b3d5f19a42
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a6d2f0c8b913"
down_revision: Union[str, None] = "e8b3d5f19a42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # "smaller", "same" or "higher" (v1.2.2), checked by the API's schema.
    # Nullable and left null on every existing row: those were rendered with
    # no bitrate cap, which none of the three names describes.
    op.add_column("exports", sa.Column("quality", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("exports", "quality")
