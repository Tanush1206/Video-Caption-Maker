import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VideoStatus(str, enum.Enum):
    """
    Lifecycle of a video through the processing pipeline.

    Inherits from `str` so it serialises to a plain string in JSON instead of
    "VideoStatus.PENDING".
    """

    PENDING = "pending"          # uploaded, waiting to be picked up
    PROCESSING = "processing"    # worker is transcribing (Milestone 4)
    COMPLETED = "completed"      # captions ready
    FAILED = "failed"            # something broke; see error_message


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[int] = mapped_column(primary_key=True)

    # ondelete="CASCADE": deleting a user removes their videos rather than
    # leaving rows pointing at a user that no longer exists.
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # What the user called it — shown in the UI, safe to edit later.
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # The name they uploaded, kept for reference. Never used to build a path;
    # see storage.py for why.
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # Path relative to the storage root, never an absolute host path, so the
    # storage location can move without rewriting every row.
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # BigInteger: a 2GB upload exceeds a signed 32-bit int.
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    content_type: Mapped[str] = mapped_column(String(128), nullable=False)

    # Milliseconds, and nullable because probing can fail on a damaged file.
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[VideoStatus] = mapped_column(
        Enum(VideoStatus, name="video_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=VideoStatus.PENDING,
        index=True,
    )

    # Populated when status is FAILED. Text, not String: tracebacks are long.
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="videos")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Video id={self.id} title={self.title!r} status={self.status.value}>"
