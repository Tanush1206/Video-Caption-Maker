"""Caption line style: auto, balanced or stacked, and words per line.

Revision ID: e3a9c71f5b28
Revises: c8f2a6d41e93

Every existing row gets Balanced and 2 words per line. Balanced is the line
breaking every caption had before, so no existing video changes.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e3a9c71f5b28"
down_revision: Union[str, None] = "c8f2a6d41e93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    line_style = sa.Enum("auto", "balanced", "stacked", name="caption_line_style")
    line_style.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "caption_styles",
        sa.Column("line_style", line_style, nullable=False, server_default="balanced"),
    )
    op.add_column(
        "caption_styles",
        sa.Column("words_per_line", sa.Integer(), nullable=False, server_default="2"),
    )


def downgrade() -> None:
    # Stacked's line limit can be up to 6; the columns before allowed 3.
    op.execute("UPDATE caption_styles SET max_lines = LEAST(max_lines, 3)")
    op.drop_column("caption_styles", "words_per_line")
    op.drop_column("caption_styles", "line_style")
    op.execute("DROP TYPE IF EXISTS caption_line_style")
