"""Record the output height a burn was rendered at.

Revision ID: e5b2c8a41f37
Revises: d7a4e91b6c05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5b2c8a41f37"
down_revision: Union[str, None] = "d7a4e91b6c05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable, and left null for every existing row rather than backfilled
    # from the source video's height.
    #
    # Null means "rendered at whatever the source was", which is exactly what
    # those rows are. Backfilling a number would claim the size was *chosen*,
    # and would go stale the moment a source is ever replaced.
    op.add_column("exports", sa.Column("height", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("exports", "height")
