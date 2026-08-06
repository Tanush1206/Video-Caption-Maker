from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Caption(Base):
    """
    One transcribed segment: a span of time and the words spoken in it.

    Times are integer milliseconds rather than floats. Caption timing is
    compared and sorted constantly, and float equality is a trap — 1.1 + 2.2
    is not 3.3. Whisper emits seconds as floats; we convert once, here.
    """

    __tablename__ = "captions"

    id: Mapped[int] = mapped_column(primary_key=True)

    video_id: Mapped[int] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Position in the transcript, 0-based. Kept explicit so captions can be
    # reordered after a split or merge without relying on timestamps.
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False)

    text: Mapped[str] = mapped_column(Text, nullable=False)

    # Whisper's average log-probability for the segment. Useful for flagging
    # low-confidence lines in the editor (Milestone 5).
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    video = relationship("Video", back_populates="captions")

    __table_args__ = (
        # Every read is "captions for this video, in order" — a composite
        # index serves that from one structure.
        Index("ix_captions_video_sequence", "video_id", "sequence"),
        # Milestone 6 seeks by playhead position: "which caption covers 42.5s".
        Index("ix_captions_video_start", "video_id", "start_ms"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Caption video={self.video_id} #{self.sequence} {self.start_ms}-{self.end_ms}>"
