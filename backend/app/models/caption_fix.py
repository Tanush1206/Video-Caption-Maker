import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FixRunStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


ACTIVE_FIX_STATUSES = (FixRunStatus.QUEUED.value, FixRunStatus.RUNNING.value)


class CaptionFixRun(Base):
    """
    One "Improve captions with Gemini" run on a video (v1.3.0).

    Only ever started by the user. The latest run is what the editor shows:
    its progress while it runs, then the list of what it changed.
    """

    __tablename__ = "caption_fix_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # A FixRunStatus value; a string so a new state is no enum migration.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=FixRunStatus.QUEUED.value)
    # Requests of up to caption_fix.BATCH_SIZE captions, and how long each
    # took on average: the time estimate is this run's own pace.
    batches_total: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    batches_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    seconds_per_batch: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Fixes Gemini offered that the checks refused (caption_fix.check).
    dropped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Requests the configured model failed and caption_fix.FALLBACK_MODEL
    # answered: the results say which model improved them.
    fallback_batches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CaptionFix(Base):
    """
    One caption's text as a run changed it: what it was, what it became.

    Undo puts `before` back, only while the caption still reads `after`: a
    caption edited by hand since keeps the edit.
    """

    __tablename__ = "caption_fixes"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("caption_fix_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Re-transcribing replaces a video's captions; their fixes go with them.
    caption_id: Mapped[int] = mapped_column(
        ForeignKey("captions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    before: Mapped[str] = mapped_column(Text, nullable=False)
    after: Mapped[str] = mapped_column(Text, nullable=False)
    undone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
