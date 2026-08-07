from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.export import ExportFormat, ExportStatus


class ExportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    video_id: int
    format: ExportFormat
    status: ExportStatus
    size_bytes: int | None
    progress: int
    error_message: str | None
    created_at: datetime

    # storage_path is deliberately absent, as everywhere else: the client gets
    # a download route, never a filesystem path.


class ExportList(BaseModel):
    items: list[ExportRead]
    total: int


class ExportCreate(BaseModel):
    format: ExportFormat


class DownloadTicket(BaseModel):
    """Short-lived credential for the download URL — an <a> can't send headers."""

    token: str
    expires_in: int
