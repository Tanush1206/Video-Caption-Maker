"""Install-wide settings, and the detail a local install shows while it works.

Revision ID: a9d3e6f20b14
Revises: f1c93d05a827
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a9d3e6f20b14"
down_revision: Union[str, None] = "f1c93d05a827"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    # What the current stage is doing, in words: "Downloading Whisper large-v3
    # (1.2 of 3.1 GB)". The stage name alone cannot say how big a wait is.
    op.add_column("videos", sa.Column("stage_detail", sa.String(200), nullable=True))
    # Something the user should know about a finished job that is not a
    # failure — "Gemini was unreachable, translated locally instead".
    op.add_column("videos", sa.Column("notice", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("videos", "notice")
    op.drop_column("videos", "stage_detail")
    op.drop_table("app_settings")
