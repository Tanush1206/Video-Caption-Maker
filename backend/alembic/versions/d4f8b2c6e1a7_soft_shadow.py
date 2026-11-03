"""A soft (blurred) shadow for captions.

Revision ID: d4f8b2c6e1a7
Revises: c3e7a9d15b42

`caption_styles.shadow_blur`, in reference pixels. Every existing row gets 0,
the hard shadow it was drawn with, so no video changes on its next export;
new styles and Reset get the model's default.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4f8b2c6e1a7"
down_revision: Union[str, None] = "c3e7a9d15b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "caption_styles",
        sa.Column("shadow_blur", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("caption_styles", "shadow_blur")
