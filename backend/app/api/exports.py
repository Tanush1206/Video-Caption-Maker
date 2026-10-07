"""Export creation, listing, and download."""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.dependencies import CurrentUser, DbSession
from app.models.caption_style import REFERENCE_HEIGHT
from app.models.export import INSTANT_FORMATS, MEDIA_TYPES, ExportFormat, ExportStatus
from app.schemas.export import (
    DownloadTicket,
    ExportCreate,
    ExportList,
    ExportOptions,
    ExportRead,
    ExportResolution,
)
from app.services import export as export_service
from app.utils.filenames import safe_stem
from app.services import media, rendering
from app.services import storage
from app.services import video as video_service
from app.utils.security import (
    TokenError,
    create_download_token,
    decode_token,
    download_token_max_age,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _require_owned_video(db, video_id: int, user_id: int):
    video = await video_service.get_owned_video(db, video_id, user_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    return video


async def _require_owned_export(db, export_id: int, user_id: int):
    export = await export_service.get_owned_export(db, export_id, user_id)
    if export is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
    return export


def download_filename(stem: str, export_format: ExportFormat) -> str:
    """
    What the browser saves an export as.

    The burn gets a suffix; the sidecars deliberately do not.

    A sidecar is named after the video **exactly** on purpose — `movie.srt`
    beside `movie.mp4` is the convention every player uses to load subtitles
    automatically, and breaking it would stop that working.

    The burn is the opposite case. It shares the source's extension, so naming
    it after the video too produced two downloads with byte-identical names:
    the browser silently saved the second as "name (1).mp4", and opening the
    obvious one showed a video with no captions in it. The file was always
    correct — it just wasn't the file you opened. A suffix costs nothing and
    makes the two distinguishable in a downloads folder.
    """
    if export_format is ExportFormat.MP4:
        return f"{stem}-captions.{export_format.value}"
    return f"{stem}.{export_format.value}"


def _queue_render(export_id: int) -> bool:
    """Lazy import, so the API process never pulls in the worker's stack."""
    try:
        from app.workers.export import render_export

        render_export.delay(export_id)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not enqueue render for export %s: %s", export_id, exc)
        return False


@router.post(
    "/videos/{video_id}/exports",
    response_model=ExportRead,
    status_code=status.HTTP_201_CREATED,
    tags=["exports"],
)
async def create_export(
    video_id: int, payload: ExportCreate, user: CurrentUser, db: DbSession
) -> ExportRead:
    """
    Produce an export.

    Sidecars are written inline and come back `completed`; a burn comes back
    `pending` and the client polls. The split is by cost, not by principle —
    formatting a transcript is milliseconds, and queueing it would mean polling
    for something that finished before the first poll went out.
    """
    video = await _require_owned_video(db, video_id, user.id)

    captions = await video_service.list_captions(db, video_id)
    if not captions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This video has no captions to export yet",
        )

    # Only a burn has a frame size. A height sent with an SRT is meaningless
    # rather than wrong, so it is dropped instead of rejected — the client has
    # one control for "export this" and it should not have to remember which
    # formats the resolution applies to.
    height = None if payload.format in INSTANT_FORMATS else payload.height

    export = await export_service.create_export(db, video, payload.format, height=height)

    if payload.format in INSTANT_FORMATS:
        export = await export_service.write_sidecar(db, export, video, captions)
        return ExportRead.model_validate(export)

    if not _queue_render(export.id):
        await export_service.delete_export(db, export)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the rendering queue. Please try again.",
        )

    return ExportRead.model_validate(export)


@router.get(
    "/videos/{video_id}/exports/options", response_model=ExportOptions, tags=["exports"]
)
async def export_options(video_id: int, user: CurrentUser, db: DbSession) -> ExportOptions:
    """
    The resolutions this video can be burned at, and what will do the encoding.

    The source is probed rather than read from a column because its dimensions
    are not stored — and probing is a few milliseconds against a local file,
    for a call the export panel makes once when it opens.

    A source that cannot be probed still gets the standard ladder, with nothing
    marked native or upscaled. Refusing to answer would disable the whole picker
    over a detail it only needs for labelling.
    """
    video = await _require_owned_video(db, video_id, user.id)

    dimensions = await media.probe_dimensions(storage.resolve(video.storage_path))
    source_width, source_height = dimensions if dimensions else (None, None)

    heights = rendering.available_heights(source_height or 0)
    resolutions = [
        ExportResolution(
            height=height,
            # Reported so the client can show "1920x1080" without having to
            # know the aspect ratio, and so the number it shows is the number
            # the render will actually use.
            width=(
                rendering.target_dimensions(source_width, source_height, height)[0]
                if source_width and source_height
                else 0
            ),
            label=f"{height}p",
            upscaled=bool(source_height and height > source_height),
            native=bool(source_height and height == source_height),
        )
        for height in heights
    ]

    # Computed here rather than in the client because it depends on the caption
    # size, which is the style's business and not something the export panel
    # should have to know about.
    style = await export_service.style_for(db, video_id)
    recommended = (
        rendering.recommended_height(source_height, style.font_size, REFERENCE_HEIGHT)
        if source_height
        else None
    )

    return ExportOptions(
        source_width=source_width,
        source_height=source_height,
        recommended_height=recommended,
        hardware_encoder="h264_nvenc" if rendering.nvenc_available() else None,
        resolutions=resolutions,
    )


@router.get("/videos/{video_id}/exports", response_model=ExportList, tags=["exports"])
async def list_exports(video_id: int, user: CurrentUser, db: DbSession) -> ExportList:
    await _require_owned_video(db, video_id, user.id)
    exports = await export_service.list_exports(db, video_id)
    return ExportList(
        items=[ExportRead.model_validate(export) for export in exports],
        total=len(exports),
    )


@router.get("/exports/{export_id}", response_model=ExportRead, tags=["exports"])
async def get_export(export_id: int, user: CurrentUser, db: DbSession) -> ExportRead:
    """Polled while a render runs, for status and progress."""
    return ExportRead.model_validate(await _require_owned_export(db, export_id, user.id))


@router.delete("/exports/{export_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["exports"])
async def delete_export(export_id: int, user: CurrentUser, db: DbSession) -> None:
    export = await _require_owned_export(db, export_id, user.id)
    await export_service.delete_export(db, export)


@router.post(
    "/exports/{export_id}/download-token", response_model=DownloadTicket, tags=["exports"]
)
async def issue_download_token(
    export_id: int, user: CurrentUser, db: DbSession
) -> DownloadTicket:
    export = await _require_owned_export(db, export_id, user.id)

    if export.status is not ExportStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This export is {export.status.value}, not ready to download",
        )

    return DownloadTicket(
        token=create_download_token(user.id, export.id),
        expires_in=download_token_max_age(),
    )


@router.get("/exports/{export_id}/download", tags=["exports"])
async def download_export(
    export_id: int,
    db: DbSession,
    name: str | None = Query(
        default=None,
        description="What to call the saved file. The extension is added here.",
    ),
    token: str = Query(..., description="A token from /download-token"),
) -> FileResponse:
    """
    Serve the exported file.

    Authenticated by query string rather than header, for the same reason the
    media stream is: a plain link cannot send an Authorization header, and
    making the browser fetch the whole file into memory to save it defeats the
    point of a download.
    """
    try:
        payload = decode_token(token, expected_type="download")
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired download token",
        ) from None

    # Without this the token would open any export the owner has, not this one.
    if payload.get("eid") != export_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This token is for a different export",
        )

    export = await _require_owned_export(db, export_id, int(payload["sub"]))

    if not export.storage_path:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This export has no file"
        )

    path = storage.resolve(export.storage_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Export file is missing"
        )

    video = await video_service.get_owned_video(db, export.video_id, int(payload["sub"]))
    stem = Path(video.original_filename).stem if video else "captions"

    # A name the user typed wins, and keeps no suffix of ours.
    #
    # `download_filename` appends "-captions" to a burn so it cannot collide
    # with the original in a downloads folder — a real problem, but one this
    # app invented on the user's behalf. Someone who has typed a name has
    # answered that question themselves, and appending to their answer would be
    # overruling it.
    chosen = safe_stem(name, extension=export.format.value) if name else ""

    return FileResponse(
        path,
        media_type=MEDIA_TYPES[export.format],
        # Named after the source video so a folder of exports is navigable,
        # and attachment because this is a download, not something to play.
        filename=(
            f"{chosen}.{export.format.value}"
            if chosen
            else download_filename(stem, export.format)
        ),
        content_disposition_type="attachment",
    )
