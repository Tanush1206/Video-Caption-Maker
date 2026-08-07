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
    # Meaningful only while status is "processing".
    progress: int
    stage: str | None
    created_at: datetime
    updated_at: datetime


class VideoUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class VideoList(BaseModel):
    items: list[VideoRead]
    total: int


class StreamTicket(BaseModel):
    """
    A short-lived credential for the media URL.

    `expires_in` is returned so the client can re-issue before playback breaks,
    rather than discovering the expiry as a failed seek.
    """

    token: str
    expires_in: int


class Waveform(BaseModel):
    """Amplitude peaks in 0..1, evenly spaced across the video's duration."""

    peaks: list[float]
    duration_ms: int | None
