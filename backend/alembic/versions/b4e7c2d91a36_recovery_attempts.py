"""How many times a restart has had to requeue a video or export.

Revision ID: b4e7c2d91a36
Revises: a9d3e6f20b14
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b4e7c2d91a36"
down_revision: Union[str, None] = "a9d3e6f20b14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Counted in the database because what it counts is restarts: a job that
    # crashes the worker (out of memory, say) would otherwise be requeued, and
    # crash it, on every start. See app/workers/recovery.py.
    for table in ("videos", "exports"):
        op.add_column(
            table,
            sa.Column("recovery_attempts", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    for table in ("exports", "videos"):
        op.drop_column(table, "recovery_attempts")
