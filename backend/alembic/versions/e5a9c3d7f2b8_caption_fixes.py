"""Improve captions with Gemini: runs and the fixes they made.

Revision ID: e5a9c3d7f2b8
Revises: d4f8b2c6e1a7

`caption_fix_runs` (one per click, with its progress) and `caption_fixes`
(each caption's text before and after, for Undo). Both go with their video;
fixes go with their caption when a video is transcribed again.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5a9c3d7f2b8"
down_revision: Union[str, None] = "d4f8b2c6e1a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "caption_fix_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("video_id", sa.Integer(), sa.ForeignKey("videos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("batches_total", sa.Integer(), nullable=False),
        sa.Column("batches_done", sa.Integer(), nullable=False),
        sa.Column("seconds_per_batch", sa.Float(), nullable=True),
        sa.Column("dropped", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_caption_fix_runs_video_id", "caption_fix_runs", ["video_id"])
    op.create_table(
        "caption_fixes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("caption_fix_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("caption_id", sa.Integer(), sa.ForeignKey("captions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("before", sa.Text(), nullable=False),
        sa.Column("after", sa.Text(), nullable=False),
        sa.Column("undone", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_caption_fixes_run_id", "caption_fixes", ["run_id"])
    op.create_index("ix_caption_fixes_caption_id", "caption_fixes", ["caption_id"])


def downgrade() -> None:
    op.drop_table("caption_fixes")
    op.drop_table("caption_fix_runs")
