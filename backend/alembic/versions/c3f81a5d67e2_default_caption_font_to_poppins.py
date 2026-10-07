"""Default the caption font to Poppins, and move styles still on the old one.

Revision ID: c3f81a5d67e2
Revises: b1e7c4d92a30
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3f81a5d67e2"
down_revision: Union[str, None] = "b1e7c4d92a30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The column default only reaches styles created from now on, and a style
    # row exists for every video that has ever been opened in the editor — so
    # without this, changing the default is invisible on everything you already
    # have. That is the whole complaint it was meant to answer.
    #
    # Scoped to rows still sitting on the old default. It cannot distinguish
    # "never chose a font" from "deliberately chose Sans", and there is no
    # modified flag to go on: this is a default change reaching styles that
    # look untouched, and anyone who did want Sans can set it back in one
    # click. Worth being explicit about rather than silent.
    op.execute("UPDATE caption_styles SET font_key = 'poppins' WHERE font_key = 'sans'")

    # `server_default` rather than only the ORM default, so a row inserted by
    # anything that is not this application still lands on the same font.
    op.alter_column(
        "caption_styles",
        "font_key",
        existing_type=sa.String(32),
        server_default="poppins",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "caption_styles",
        "font_key",
        existing_type=sa.String(32),
        server_default="sans",
        existing_nullable=False,
    )
    op.execute("UPDATE caption_styles SET font_key = 'sans' WHERE font_key = 'poppins'")
