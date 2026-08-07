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

    So the knobs are the intersection: font, size, weight, slant, fill colour,
    outline colour and width, an optional opaque box, alignment and margin.
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
    font_key: Mapped[str] = mapped_column(String(32), nullable=False, default="sans")

    font_size: Mapped[int] = mapped_column(Integer, nullable=False, default=54)
    bold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    italic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # #RRGGBB. Stored as text because it is displayed far more often than it is
    # computed with, and an integer column would need decoding at every read.
    text_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#FFFFFF")

    outline_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#000000")
    outline_width: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    box_color: Mapped[str] = mapped_column(String(7), nullable=False, default="#000000")
    # 0 disables the box entirely, which is also what switches ASS BorderStyle
    # from 3 (opaque box) back to 1 (outline and shadow).
    box_opacity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

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
    margin_v: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    margin_h: Mapped[int] = mapped_column(Integer, nullable=False, default=60)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    video = relationship("Video", back_populates="style")

    @property
    def box_padding(self) -> int:
        """
        Space between the glyphs and the edge of the box, in reference pixels.

        A property on the model rather than a rule each renderer reimplements.
        The ASS conversion and the browser's CSS both read this, so the box in
        the preview is the same size as the box in the export — recomputing it
        in TypeScript would be one more place for the two to drift apart.
        """
        if self.box_opacity <= 0:
            return 0
        return max(self.outline_width, BOX_PADDING_MIN)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CaptionStyle video={self.video_id} {self.font_key} {self.font_size}px>"
