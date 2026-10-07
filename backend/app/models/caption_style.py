import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Sizes are stored against a 1080p canvas and scaled by (height / 1080) at both
# preview and render time. Storing raw pixels would make a style mean something
# different on every video; storing percentages would make the editor's numbers
# meaningless to a human. One reference height gives both.
REFERENCE_HEIGHT = 1080

# Minimum breathing room between the text and the edge of its box, in reference
# pixels. Without a floor, a style with no outline draws a box that the glyphs
# touch on every side.
BOX_PADDING_MIN = 8


class VerticalPosition(str, enum.Enum):
    TOP = "top"
    MIDDLE = "middle"
    BOTTOM = "bottom"


class Alignment(str, enum.Enum):
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class CaptionStyle(Base):
    """
    How a video's captions look.

    Every field here has to be expressible **both** in CSS, for the editor's
    live preview, and in an ASS style line, for the burn-in FFmpeg will do in
    Milestone 8. That constraint is the whole design: a property only CSS can
    do (a gradient fill, a blurred shadow) would make the preview a promise the
    renderer cannot keep, and the preview is supposed to be the contract.

    So the knobs are the intersection: font, size, weight, slant, decoration,
    tracking, fill colour, outline, drop shadow, an optional opaque box,
    alignment and margin.

    `uppercase` is the single exception, and it earns it: ASS has no property
    for letter case, so the burn-in transforms the text and the preview uses
    `text-transform`. Two mechanisms, one visible result — which is allowed,
    where "a gradient the renderer cannot draw" is not.

    Deliberately absent: `ScaleX`/`ScaleY` (stretch) and `Angle` (rotation).
    ASS has all three and CSS can imitate them, but stretching glyphs changes
    their advance widths, so the two renderers would wrap lines in different
    places — the exact failure this class is shaped to prevent.
    """

    __tablename__ = "caption_styles"

    id: Mapped[int] = mapped_column(primary_key=True)

    # unique=True: exactly one style per video. A style has no meaning without
    # its video, so it cascades away with it.
    video_id: Mapped[int] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )

    # A key from FONTS in services/caption_style.py, not a free-text family
    # name. libass silently substitutes a font it doesn't have, so an
    # unconstrained string is a preview that lies.
    # Poppins, not "sans". The system face resolves to Arial in the browser
    # and Liberation Sans in the burn — correct, metric-compatible, and the
    # plainest thing on screen. A captioning tool should not open on the font
    # you get when nobody chose one.
    #
    # Distinct from DEFAULT_FONT_KEY in services/caption_style.py, which is the
    # *fallback* for a style naming a font that no longer exists. That stays a
    # system face on purpose: a fallback should need nothing to be present.
    font_key: Mapped[str] = mapped_column(String(32), nullable=False, default="poppins")

    font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=54)
    bold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    italic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # #RRGGBB. Stored as text because it is displayed far more often than it is
    # computed with, and an integer column would need decoding at every read.
    text_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#FFFFFF")

    outline_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#000000")
    outline_width: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Drop shadow, in reference pixels. ASS offsets it down-and-right by this
    # distance with no blur, which is exactly what a CSS `text-shadow` with a
    # zero blur radius draws — the two agree without either side approximating.
    #
    # Its own colour rather than reusing the outline's, because a shadow is
    # usually a softer version of the text and an outline usually is not.
    shadow: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    shadow_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#000000")

    box_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#000000")
    # 0 disables the box entirely, which is also what switches ASS BorderStyle
    # from 3 (opaque box) back to 1 (outline and shadow).
    box_opacity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Space between the glyphs and the edge of the box, in reference pixels.
    #
    # This used to be derived as `max(outline_width, 8)`, which meant widening
    # an outline that is not even drawn when boxed silently changed the box.
    # An explicit column is one fewer surprise, and the migration seeds every
    # existing row with what the old rule would have produced so no box moves.
    box_padding: Mapped[int] = mapped_column(
        Integer, nullable=False, default=BOX_PADDING_MIN
    )

    # ASS has real fields for these, in the Style line, so they cost nothing to
    # honour in the burn-in and map one-to-one onto `text-decoration-line`.
    underline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    strikeout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ASS `Spacing`, in reference pixels — extra tracking between glyphs.
    letter_spacing: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # The one field with no ASS equivalent. There is no "render this uppercase"
    # style property, so the burn-in upper-cases the dialogue text itself and
    # the preview uses `text-transform`. Deliberately *not* applied to the
    # stored captions or to the SRT/VTT sidecars: this is how the captions are
    # drawn on the video, not what they say.
    uppercase: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    position: Mapped[VerticalPosition] = mapped_column(
        Enum(VerticalPosition, name="caption_vertical_position",
             values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=VerticalPosition.BOTTOM,
    )
    alignment: Mapped[Alignment] = mapped_column(
        Enum(Alignment, name="caption_alignment",
             values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=Alignment.CENTER,
    )

    # Distance from the edge the captions sit against, in reference pixels.
    #
    # `margin_h` keeps a second job under free placement, below: ASS derives the
    # line-wrapping width from MarginL/MarginR whether or not the caption is
    # positioned by hand, so it stays meaningful in both modes.
    margin_v: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    margin_h: Mapped[int] = mapped_column(Integer, nullable=False, default=60)

    # Free placement: where the caption sits as a fraction of the frame, 0..1.
    #
    # NULL means "anchored", and the pair above does the positioning — nine
    # anchors and a gap from the edge, which is all an ASS *Style* line can say.
    # That remains the default and every existing row keeps it.
    #
    # When both are set the burn-in switches to a per-event `\pos()` override
    # instead. That is a different mechanism from the Style line, and it was
    # avoided for exactly that reason until it was actually measured: burning
    # the same text with and without `\pos` puts it in the same place to within
    # a pixel, and — the part that decides it — MarginL/MarginR still govern
    # where lines wrap under `\pos`. So the override buys arbitrary placement
    # without costing the wrap width, and the preview can still describe
    # everything the export will do.
    #
    # Fractions rather than reference pixels because this is the one geometry
    # the user sets by pointing at the frame, and a fraction survives a video
    # of any shape. Nullable rather than defaulted to the centre so that
    # "never placed by hand" stays distinguishable from "placed at 0.5".
    pos_x: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    pos_y: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    video = relationship("Video", back_populates="style")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CaptionStyle video={self.video_id} {self.font_key} {self.font_size}px>"
