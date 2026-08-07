import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ExportFormat(str, enum.Enum):
    """
    What comes out.

    The three sidecars are text files generated in milliseconds. `mp4` burns
    the captions into the pixels, takes minutes, and is the only one that needs
    the worker — which is why the request path branches on this.
    """

    SRT = "srt"
    VTT = "vtt"
    JSON = "json"
    MP4 = "mp4"


class ExportStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# Sidecars are produced synchronously; only a burn is queued.
INSTANT_FORMATS = {ExportFormat.SRT, ExportFormat.VTT, ExportFormat.JSON}

MEDIA_TYPES = {
    ExportFormat.SRT: "application/x-subrip",
    ExportFormat.VTT: "text/vtt",
    ExportFormat.JSON: "application/json",
    ExportFormat.MP4: "video/mp4",
}


class Export(Base):
    """
    One produced artifact.

    Kept as rows rather than generated on demand because a burn is expensive:
    re-rendering a 40-minute video because someone reloaded the page would be
    minutes of GPU-adjacent CPU for a file that already exists.
    """

    __tablename__ = "exports"

    id: Mapped[int] = mapped_column(primary_key=True)

    video_id: Mapped[int] = mapped_column(
        ForeignKey("videos.id", ondelete="CASCADE"), nullable=False, index=True
    )

    format: Mapped[ExportFormat] = mapped_column(
        Enum(ExportFormat, name="export_format", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    status: Mapped[ExportStatus] = mapped_column(
        Enum(ExportStatus, name="export_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ExportStatus.PENDING,
    )

    # Relative to the storage root, and null until the file exists.
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    video = relationship("Video", back_populates="exports")

    __table_args__ = (
        # Every read is "this video's exports, newest first".
        Index("ix_exports_video_created", "video_id", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Export {self.id} video={self.video_id} {self.format.value} {self.status.value}>"
