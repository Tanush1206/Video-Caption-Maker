"""Export creation, listing, and download."""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.dependencies import CurrentUser, DbSession
from app.models.export import INSTANT_FORMATS, MEDIA_TYPES, ExportStatus
from app.schemas.export import (
    DownloadTicket,
    ExportCreate,
    ExportList,
    ExportRead,
)
from app.services import export as export_service
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

    export = await export_service.create_export(db, video, payload.format)

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

    return FileResponse(
        path,
        media_type=MEDIA_TYPES[export.format],
        # Named after the source video so a folder of exports is navigable,
        # and attachment because this is a download, not something to play.
        filename=f"{stem}.{export.format.value}",
        content_disposition_type="attachment",
    )
