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

    # What is being spoken, and what the captions should come out in.
    #
    # Stored on the video rather than passed per request so that pressing
    # "Redo" repeats the choice instead of silently reverting to auto-detect —
    # re-running a transcription is almost always an attempt to improve the
    # last one, not to start the argument over.
    #
    # `auto` asks Whisper to detect the spoken language, which is the default
    # and, on anything sung, measurably the worst option available: on a
    # Punjabi song auto-detect covered 42 of 90 seconds at an average logprob
    # of -1.77, where naming a language covered 81-87s at -0.71. Hence the
    # control existing at all.
    spoken_language: Mapped[str] = mapped_column(
        String(16), nullable=False, default="auto", server_default="auto"
    )
    # `same` means "leave them in whatever was spoken". Any other value is a
    # target the captions get translated into.
    caption_language: Mapped[str] = mapped_column(
        String(16), nullable=False, default="same", server_default="same"
    )

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

    # Progress through the current pipeline stage, 0-100. Transient: it is
    # meaningful only while status is PROCESSING.
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # Which stage is running ("extracting", "transcribing", "embedding"), so
    # the UI can say something more useful than a bare percentage.
    stage: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Words for the current stage ("Downloading Whisper large-v3, 1.2 of
    # 3.1 GB"), and a note on a finished job that is not a failure ("Gemini
    # was unreachable, translated locally instead").
    stage_detail: Mapped[str | None] = mapped_column(String(200), nullable=True)
    notice: Mapped[str | None] = mapped_column(String(300), nullable=True)

    owner = relationship("User", back_populates="videos")
    # uselist=False: one style per video, so this reads as an object, not a
    # one-element list. Created lazily — a video with no style row uses the
    # defaults rather than being wrong.
    style = relationship(
        "CaptionStyle",
        back_populates="video",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )
    exports = relationship(
        "Export",
        back_populates="video",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Export.created_at.desc()",
    )
    captions = relationship(
        "Caption",
        back_populates="video",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Caption.sequence",
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Video id={self.id} title={self.title!r} status={self.status.value}>"
