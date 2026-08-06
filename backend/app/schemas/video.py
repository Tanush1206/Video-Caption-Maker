from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.video import VideoStatus


class VideoRead(BaseModel):
    """
    What the API returns for a video.

    storage_path and thumbnail_path are deliberately absent — internal
    filesystem layout is not the client's business, and exposing it invites
    people to construct their own URLs. Files are served through
    /api/videos/{id}/stream and /thumbnail instead.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    original_filename: str
    size_bytes: int
    content_type: str
    duration_ms: int | None
    status: VideoStatus
    error_message: str | None
    has_thumbnail: bool
    created_at: datetime
    updated_at: datetime


class VideoUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class VideoList(BaseModel):
    items: list[VideoRead]
    total: int
