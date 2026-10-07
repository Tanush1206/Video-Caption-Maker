from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.video import VideoStatus
from app.services import languages


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

    # What was asked for last time this video was transcribed, so the editor
    # can show the current choice rather than resetting the controls to their
    # defaults every time the page loads.
    spoken_language: str = "auto"
    caption_language: str = "same"

    # Meaningful only while status is "processing".
    progress: int
    stage: str | None
    # A sentence about the current stage, e.g. a model download's size.
    stage_detail: str | None = None
    # A non-fatal note on a finished job, e.g. a translation fallback.
    notice: str | None = None
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


class TranscribeRequest(BaseModel):
    """
    What to transcribe into.

    Both optional: an empty body re-runs with whatever the video already had,
    which is what "try that again" means. Sending one field changes it and
    leaves the other alone.
    """

    spoken_language: str | None = None
    caption_language: str | None = None

    @field_validator("spoken_language")
    @classmethod
    def known_spoken(cls, value: str | None) -> str | None:
        if value is not None and not languages.is_spoken_language(value):
            raise ValueError(f"Unsupported spoken language: {value}")
        return value

    @field_validator("caption_language")
    @classmethod
    def known_caption(cls, value: str | None) -> str | None:
        if value is not None and not languages.is_caption_language(value):
            raise ValueError(f"Unsupported caption language: {value}")
        return value


class LanguageOption(BaseModel):
    code: str
    label: str


class LanguageOptions(BaseModel):
    """
    Served rather than hardcoded in the client, for the same reason the font
    list is: offering a language the pipeline cannot deliver is worse than
    offering fewer.
    """

    spoken: list[LanguageOption]
    caption: list[LanguageOption]
    #: False when no translation key is configured, so the client can say why
    #: the non-English targets are unavailable instead of failing silently.
    translation_available: bool
