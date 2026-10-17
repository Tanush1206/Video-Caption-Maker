"""Caption box: a width, a line limit, and the position as its centre.

Revision ID: c8f2a6d41e93
Revises: b4e7c2d91a36

The anchor (`position` + `margin_v`) and the side margin go: every caption is
now a box of its own width (`box_width`, NULL for the frame's default), placed
by its centre (`pos_x`/`pos_y`, never NULL) and slid inside a safe area per
caption at render time (services/caption_layout.py).

Existing rows are converted so old videos still look right:

  - An anchored caption gets the centre a one-line caption had: the margin,
    the padding (or outline) and half the font's cell in from its edge, or the
    frame's middle. Longer captions grow around that and the safe area keeps
    them in frame.
  - A left- or right-aligned caption was anchored by its left or right edge;
    the centre is half the default width (0.80) further in. The video's shape
    isn't stored, so 16:9 is assumed for the side margin (1920 reference px).
  - A centred hand-placed caption already stored its centre.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c8f2a6d41e93"
down_revision: Union[str, None] = "b4e7c2d91a36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Half the default box width, 0.80.
_HALF = 0.4


def upgrade() -> None:
    op.add_column("caption_styles", sa.Column("box_width", sa.Float(), nullable=True))
    op.add_column(
        "caption_styles",
        sa.Column("max_lines", sa.Integer(), nullable=False, server_default="2"),
    )

    # Hand-placed, by an edge: the centre is half the width further in. First,
    # while the anchored rows are still the ones with NULLs.
    op.execute(
        f"""
        UPDATE caption_styles SET
          pos_x = CASE alignment::text
                    WHEN 'left' THEN pos_x + {_HALF}
                    WHEN 'right' THEN pos_x - {_HALF}
                    ELSE pos_x
                  END
        WHERE pos_x IS NOT NULL AND pos_y IS NOT NULL
        """
    )
    edge = (
        "(margin_v + CASE WHEN box_opacity > 0 THEN box_padding ELSE outline_width END"
        " + font_size / 2.0) / 1080.0"
    )
    op.execute(
        f"""
        UPDATE caption_styles SET
          pos_y = CASE position::text
                    WHEN 'top' THEN {edge}
                    WHEN 'middle' THEN 0.5
                    ELSE 1 - {edge}
                  END,
          pos_x = CASE alignment::text
                    WHEN 'left' THEN margin_h / 1920.0 + {_HALF}
                    WHEN 'right' THEN 1 - margin_h / 1920.0 - {_HALF}
                    ELSE 0.5
                  END
        WHERE pos_x IS NULL OR pos_y IS NULL
        """
    )
    op.execute(
        "UPDATE caption_styles SET pos_x = LEAST(1, GREATEST(0, pos_x)),"
        " pos_y = LEAST(1, GREATEST(0, pos_y))"
    )
    op.alter_column("caption_styles", "pos_x", nullable=False)
    op.alter_column("caption_styles", "pos_y", nullable=False)

    op.drop_column("caption_styles", "position")
    op.drop_column("caption_styles", "margin_v")
    op.drop_column("caption_styles", "margin_h")
    op.execute("DROP TYPE IF EXISTS caption_vertical_position")


def downgrade() -> None:
    # Back to hand-placed captions at the same centre (left and right aligned
    # ones by their edge again), on the old defaults for the anchor columns.
    position = sa.Enum("top", "middle", "bottom", name="caption_vertical_position")
    position.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "caption_styles",
        sa.Column("position", position, nullable=False, server_default="bottom"),
    )
    op.add_column(
        "caption_styles",
        sa.Column("margin_v", sa.Integer(), nullable=False, server_default="60"),
    )
    op.add_column(
        "caption_styles",
        sa.Column("margin_h", sa.Integer(), nullable=False, server_default="60"),
    )
    op.alter_column("caption_styles", "pos_x", nullable=True)
    op.alter_column("caption_styles", "pos_y", nullable=True)
    op.execute(
        f"""
        UPDATE caption_styles SET
          pos_x = LEAST(1, GREATEST(0, CASE alignment::text
                    WHEN 'left' THEN pos_x - {_HALF}
                    WHEN 'right' THEN pos_x + {_HALF}
                    ELSE pos_x
                  END))
        """
    )
    op.drop_column("caption_styles", "max_lines")
    op.drop_column("caption_styles", "box_width")
