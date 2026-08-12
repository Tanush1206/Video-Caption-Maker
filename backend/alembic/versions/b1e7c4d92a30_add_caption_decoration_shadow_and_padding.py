"""add caption decoration, shadow, tracking and explicit box padding

Revision ID: b1e7c4d92a30
Revises: 0bddc3271cec
Create Date: 2026-08-12 12:40:00.000000

Six new style knobs, five of which map straight onto ASS Style fields that the
exporter was already writing as hardcoded zeros.

`box_padding` is the interesting one: it was a derived property,
`max(outline_width, 8)`, so widening an outline that is not even drawn when a
box is on would silently change the box. It becomes a real column, and every
existing row is seeded with what the old rule would have produced so that no
caption box shifts on deploy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1e7c4d92a30"
down_revision: Union[str, None] = "0bddc3271cec"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Mirrors BOX_PADDING_MIN in app/models/caption_style.py. Repeated as a literal
# on purpose: a migration describes the database at one moment in history and
# must not change meaning later because a constant was edited.
BOX_PADDING_MIN = 8


def upgrade() -> None:
    # server_default on the ADD, so existing rows get a value without a table
    # rewrite pass per column, then dropped so the ORM default is the only
    # place a new row's value is decided.
    op.add_column(
        "caption_styles",
        sa.Column("shadow", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "caption_styles",
        sa.Column(
            "shadow_color", sa.String(length=7), nullable=False, server_default="#000000"
        ),
    )
    op.add_column(
        "caption_styles",
        sa.Column("underline", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "caption_styles",
        sa.Column("strikeout", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "caption_styles",
        sa.Column("letter_spacing", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "caption_styles",
        sa.Column("uppercase", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "caption_styles",
        sa.Column(
            "box_padding",
            sa.Integer(),
            nullable=False,
            server_default=str(BOX_PADDING_MIN),
        ),
    )

    # The old derived rule, frozen into the data. Without this, anyone whose
    # outline is wider than the floor would see their box tighten on deploy.
    op.execute(
        f"UPDATE caption_styles SET box_padding = GREATEST(outline_width, {BOX_PADDING_MIN})"
    )

    for column in (
        "shadow",
        "shadow_color",
        "underline",
        "strikeout",
        "letter_spacing",
        "uppercase",
        "box_padding",
    ):
        op.alter_column("caption_styles", column, server_default=None)


def downgrade() -> None:
    for column in (
        "box_padding",
        "uppercase",
        "letter_spacing",
        "strikeout",
        "underline",
        "shadow_color",
        "shadow",
    ):
        op.drop_column("caption_styles", column)
