from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.export import ExportFormat, ExportStatus
from app.services.rendering import MAX_OUTPUT_HEIGHT


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

    # Null for a sidecar, and for a burn rendered at the source's own size.
    height: int | None = None

    # storage_path is deliberately absent, as everywhere else: the client gets
    # a download route, never a filesystem path.


class ExportList(BaseModel):
    items: list[ExportRead]
    total: int


class ExportCreate(BaseModel):
    format: ExportFormat

    # The output frame height for a burn. Omitted means the source's own size,
    # which keeps every existing client working and is the only choice that
    # cannot soften the picture.
    #
    # Bounded here as well as in the render service because this is user input
    # reaching an encoder: a height of 100000 is minutes of work and a file
    # nobody can play, and a negative one is an FFmpeg error the user would see
    # as a failed export with no explanation.
    height: int | None = Field(default=None, ge=144, le=MAX_OUTPUT_HEIGHT)


class DownloadTicket(BaseModel):
    """Short-lived credential for the download URL — an <a> can't send headers."""

    token: str
    expires_in: int


class ExportResolution(BaseModel):
    """One offer in the resolution picker."""

    height: int
    width: int
    label: str
    #: Above the source's own height, so the picture gains no detail.
    upscaled: bool
    #: The source's own size, and therefore the no-resampling choice.
    native: bool


class ExportOptions(BaseModel):
    """
    What this installation can render, for one video.

    Served rather than hardcoded in the client for the same reason the font
    list is: the answer depends on the machine doing the work, and a client
    that guesses will eventually offer something the server cannot deliver.

    Note the capability reported is the *server's*. Burning captions is an
    FFmpeg re-encode that happens in the worker; the browser only downloads the
    result, so whatever card the person downloading has makes no difference to
    what can be produced.
    """

    source_width: int | None
    source_height: int | None
    #: What to default the picker to. Not simply the source's own height: a
    #: small source renders captions too small to read, and the default has to
    #: rescue that rather than reproduce it.
    recommended_height: int | None
    #: The hardware encoder in use, or null when falling back to CPU x264.
    hardware_encoder: str | None
    resolutions: list[ExportResolution]
