"""Video upload, listing, and retrieval."""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.config import get_settings
from app.dependencies import CurrentUser, DbSession
from app.models.video import VideoStatus
from app.schemas.caption import CaptionList, CaptionRead
from app.schemas.video import StreamTicket, VideoList, VideoRead, VideoUpdate, Waveform
from app.services import media, storage
from app.services import video as video_service
from app.utils.security import (
    TokenError,
    create_stream_token,
    decode_token,
    stream_token_max_age,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()

MAX_UPLOAD_BYTES = settings.max_upload_size_mb * 1024 * 1024


def _to_read(video) -> VideoRead:
    """has_thumbnail is derived, so the client never sees a filesystem path."""
    return VideoRead(
        id=video.id,
        title=video.title,
        original_filename=video.original_filename,
        size_bytes=video.size_bytes,
        content_type=video.content_type,
        duration_ms=video.duration_ms,
        status=video.status,
        error_message=video.error_message,
        has_thumbnail=bool(video.thumbnail_path),
        progress=video.progress,
        stage=video.stage,
        created_at=video.created_at,
        updated_at=video.updated_at,
    )


def _enqueue_transcription(video_id: int) -> bool:
    """
    Hand the video to the worker.

    Imported here rather than at module scope so the API process never pulls
    in the worker's heavy ML dependencies. A queue failure is logged and
    swallowed: the upload itself succeeded, and the user can retry from the UI.
    """
    try:
        from app.workers.transcription import transcribe_video

        transcribe_video.delay(video_id)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not enqueue transcription for video %s: %s", video_id, exc)
        return False


async def _stream_to_disk(upload: UploadFile, destination: Path) -> int:
    """
    Write the upload to disk in chunks, enforcing the size cap as we go.

    The cap cannot be trusted to Content-Length: it is client-supplied and a
    malicious client can understate it. Counting real bytes and aborting mid
    stream is the only enforcement that holds. Chunking also keeps a 2 GB file
    from being buffered in memory.
    """
    total = 0
    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        with destination.open("wb") as out:
            while chunk := await upload.read(storage.CHUNK_SIZE):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File exceeds the {settings.max_upload_size_mb}MB limit",
                    )
                out.write(chunk)
    except Exception:
        # Never leave a partial file behind, whether the cap tripped or the
        # connection dropped mid-upload.
        destination.unlink(missing_ok=True)
        raise

    return total


@router.post("", response_model=VideoRead, status_code=status.HTTP_201_CREATED)
async def upload_video(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> VideoRead:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No filename provided"
        )

    suffix = Path(file.filename).suffix.lower()

    # Both checks matter: the content type is a client-supplied claim, and the
    # extension is trivially renamed. Neither alone is worth much; requiring
    # both agree rejects the easy cases. Real content sniffing happens when
    # ffprobe reads the file below.
    if file.content_type not in storage.ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported content type: {file.content_type}",
        )
    if suffix not in storage.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file extension: {suffix or '(none)'}",
        )

    absolute, relative = storage.build_storage_path(user.id, file.filename)
    size = await _stream_to_disk(file, absolute)

    if size == 0:
        absolute.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty"
        )

    video = await video_service.create_video(
        db,
        owner_id=user.id,
        title=Path(file.filename).stem[:255] or "Untitled",
        original_filename=file.filename[:255],
        storage_path=relative,
        size_bytes=size,
        content_type=file.content_type,
    )

    # Probing also confirms the bytes really are video, whatever the client
    # claimed. Failures are non-fatal: the upload is kept, just without
    # metadata, rather than thrown away over a cosmetic feature.
    duration_ms = await media.probe_duration_ms(absolute)

    thumbnail_relative = None
    thumb_absolute = storage.storage_root() / f"user_{user.id}" / f"{absolute.stem}.jpg"
    if await media.generate_thumbnail(absolute, thumb_absolute, duration_ms):
        thumbnail_relative = f"user_{user.id}/{thumb_absolute.name}"

    if duration_ms is not None or thumbnail_relative is not None:
        video = await video_service.update_metadata(
            db, video, duration_ms=duration_ms, thumbnail_path=thumbnail_relative
        )

    _enqueue_transcription(video.id)

    return _to_read(video)


@router.get("", response_model=VideoList)
async def list_videos(
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: VideoStatus | None = Query(default=None, alias="status"),
) -> VideoList:
    """
    The caller's videos, newest first.

    `total` counts everything matching the filter, not what came back in
    `items` — the client needs to know how many pages exist, and the page it
    is holding cannot tell it that.
    """
    videos, total = await video_service.list_videos(
        db, user.id, limit=limit, offset=offset, status=status_filter
    )
    return VideoList(items=[_to_read(v) for v in videos], total=total)


async def _require_owned(db, video_id: int, user_id: int):
    video = await video_service.get_owned_video(db, video_id, user_id)
    if video is None:
        # 404 rather than 403 even when the id exists but belongs to someone
        # else — a 403 would confirm the id is real.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    return video


@router.get("/{video_id}", response_model=VideoRead)
async def get_video(video_id: int, user: CurrentUser, db: DbSession) -> VideoRead:
    return _to_read(await _require_owned(db, video_id, user.id))


@router.patch("/{video_id}", response_model=VideoRead)
async def rename_video(
    video_id: int, payload: VideoUpdate, user: CurrentUser, db: DbSession
) -> VideoRead:
    video = await _require_owned(db, video_id, user.id)
    return _to_read(await video_service.rename(db, video, payload.title))


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(video_id: int, user: CurrentUser, db: DbSession) -> None:
    video = await _require_owned(db, video_id, user.id)
    await video_service.delete_video(db, video)


@router.post("/{video_id}/transcribe", response_model=VideoRead)
async def retranscribe(video_id: int, user: CurrentUser, db: DbSession) -> VideoRead:
    """
    Queue (or re-queue) transcription.

    Safe to call on a completed video: the task clears existing captions and
    vectors before writing new ones.
    """
    video = await _require_owned(db, video_id, user.id)

    if video.status == VideoStatus.PROCESSING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This video is already being transcribed",
        )

    video = await video_service.mark_queued(db, video)

    if not _enqueue_transcription(video.id):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach the processing queue. Please try again.",
        )

    return _to_read(video)


@router.get("/{video_id}/captions", response_model=CaptionList)
async def list_captions(video_id: int, user: CurrentUser, db: DbSession) -> CaptionList:
    await _require_owned(db, video_id, user.id)
    captions = await video_service.list_captions(db, video_id)
    return CaptionList(
        items=[CaptionRead.model_validate(caption) for caption in captions],
        total=len(captions),
    )


@router.get("/{video_id}/thumbnail")
async def get_thumbnail(video_id: int, user: CurrentUser, db: DbSession) -> FileResponse:
    video = await _require_owned(db, video_id, user.id)

    if not video.thumbnail_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail for this video"
        )

    path = storage.resolve(video.thumbnail_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Thumbnail file is missing"
        )

    return FileResponse(path, media_type="image/jpeg")


@router.post("/{video_id}/stream-token", response_model=StreamTicket)
async def issue_stream_token(
    video_id: int, user: CurrentUser, db: DbSession
) -> StreamTicket:
    """
    Mint a URL-embeddable credential for this video's media stream.

    This exists because a <video> element cannot send an Authorization header:
    the browser issues the media requests itself, including the range requests
    it makes while seeking, and gives us no hook to attach one. The URL has to
    carry the proof instead. Ownership is checked here, once, against the
    normal bearer token.
    """
    await _require_owned(db, video_id, user.id)

    return StreamTicket(
        token=create_stream_token(user.id, video_id),
        expires_in=stream_token_max_age(),
    )


@router.get("/{video_id}/stream")
async def stream_video(
    video_id: int,
    db: DbSession,
    token: str = Query(..., description="A stream token from /stream-token"),
    download: bool = Query(
        default=False, description="Send as an attachment rather than for playback"
    ),
) -> FileResponse:
    """
    Serve the video file itself, byte for byte as it was uploaded.

    Files live outside the webroot and are never served statically, so this is
    the only way to reach them. Note the missing CurrentUser: this is the one
    route authenticated by query string rather than header, for the reason
    given on /stream-token above.

    Nothing in this application re-encodes video. The upload is streamed to
    disk unmodified and handed back the same way; FFmpeg only ever *reads* it,
    writing a JPEG thumbnail, a scratch WAV for Whisper, and waveform peaks to
    separate files.
    """
    try:
        payload = decode_token(token, expected_type="stream")
    except TokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired stream token"
        ) from None

    # Without this the token would be a key to the whole library rather than to
    # one file, and a leaked URL would expose every video its owner has.
    if payload.get("vid") != video_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This token is for a different video",
        )

    video = await _require_owned(db, video_id, int(payload["sub"]))

    path = storage.resolve(video.storage_path)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Video file is missing"
        )

    # FileResponse answers a Range header with 206 and just that slice of the
    # file, which is what lets the player seek to the middle of a two-hour
    # video without downloading the first hour.
    #
    # The filename matters even for playback. Without it the browser saves
    # "Save video as…" under the last path segment — `stream`, with no
    # extension — and a file with no extension is one Windows won't open and
    # some players mis-handle. `inline` rather than `attachment` so a media
    # element still plays it; `download=1` flips that for an explicit save.
    return FileResponse(
        path,
        media_type=video.content_type,
        filename=video.original_filename,
        content_disposition_type="attachment" if download else "inline",
    )


@router.get("/{video_id}/waveform", response_model=Waveform)
async def get_waveform(video_id: int, user: CurrentUser, db: DbSession) -> Waveform:
    """
    Amplitude peaks for the timeline, computed once and cached beside the file.

    Decoding the audio takes seconds on a long video, so the result is written
    to disk. Doing this in the browser instead would mean downloading the whole
    file and decoding it in the main thread before the timeline could draw.
    """
    video = await _require_owned(db, video_id, user.id)

    source = storage.resolve(video.storage_path)
    if not source.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Video file is missing"
        )

    cache = storage.resolve(storage.waveform_cache_path(video.storage_path))
    if cache.exists():
        try:
            return Waveform(peaks=json.loads(cache.read_text()), duration_ms=video.duration_ms)
        except (json.JSONDecodeError, OSError) as exc:
            # A truncated cache from an interrupted write is worth redoing, not
            # worth failing over.
            logger.warning("Discarding unreadable waveform cache for video %s: %s", video_id, exc)

    peaks = await media.extract_waveform_peaks(source, video.duration_ms)

    if peaks:
        try:
            # Write then rename, so a crash mid-write can't leave a half-file
            # that the branch above would happily read back.
            temporary = cache.with_suffix(".tmp")
            temporary.write_text(json.dumps(peaks))
            temporary.replace(cache)
        except OSError as exc:
            logger.warning("Could not cache waveform for video %s: %s", video_id, exc)

    return Waveform(peaks=peaks, duration_ms=video.duration_ms)
