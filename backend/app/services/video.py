"""Video persistence. Ownership is enforced here, not left to callers."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption import Caption
from app.models.video import Video, VideoStatus
from app.services import storage


async def create_video(
    db: AsyncSession,
    *,
    owner_id: int,
    title: str,
    original_filename: str,
    storage_path: str,
    size_bytes: int,
    content_type: str,
) -> Video:
    video = Video(
        owner_id=owner_id,
        title=title,
        original_filename=original_filename,
        storage_path=storage_path,
        size_bytes=size_bytes,
        content_type=content_type,
        status=VideoStatus.PENDING,
    )
    db.add(video)
    await db.commit()
    await db.refresh(video)
    return video


async def get_owned_video(db: AsyncSession, video_id: int, owner_id: int) -> Video | None:
    """
    Fetch a video only if it belongs to this user.

    Filtering by owner in the query — rather than loading by id and comparing
    afterwards — makes it impossible to forget the check at a call site. A
    video belonging to someone else is indistinguishable from one that does
    not exist, which is also why callers return 404 rather than 403: a 403
    would confirm the id is real.
    """
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def list_videos(
    db: AsyncSession,
    owner_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: VideoStatus | None = None,
) -> tuple[list[Video], int]:
    """
    Newest first, with the total count for pagination.

    The filter is applied in SQL and counted with the same predicate, not
    handed to the client to apply. Filtering a paginated response in the
    browser would only ever filter the page you happen to be looking at — ask
    for failed videos on page one and you get however many of the newest
    twelve happen to have failed, which looks like an answer and is not one.
    """
    conditions = [Video.owner_id == owner_id]
    if status is not None:
        conditions.append(Video.status == status)

    total = await db.scalar(select(func.count()).select_from(Video).where(*conditions))

    result = await db.execute(
        select(Video)
        .where(*conditions)
        # id as a tiebreaker, not decoration: two videos uploaded in the same
        # moment would otherwise have no defined order between them, and could
        # swap places between page one and page two — showing one twice and
        # hiding the other entirely.
        .order_by(Video.created_at.desc(), Video.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), int(total or 0)


async def update_metadata(
    db: AsyncSession,
    video: Video,
    *,
    duration_ms: int | None = None,
    thumbnail_path: str | None = None,
) -> Video:
    if duration_ms is not None:
        video.duration_ms = duration_ms
    if thumbnail_path is not None:
        video.thumbnail_path = thumbnail_path
    await db.commit()
    await db.refresh(video)
    return video


async def rename(db: AsyncSession, video: Video, title: str) -> Video:
    video.title = title
    await db.commit()
    await db.refresh(video)
    return video


async def mark_queued(db: AsyncSession, video: Video) -> Video:
    """Reset processing state before handing the video back to the worker."""
    video.status = VideoStatus.PENDING
    video.stage = None
    video.progress = 0
    video.error_message = None
    await db.commit()
    await db.refresh(video)
    return video


async def list_captions(db: AsyncSession, video_id: int) -> list[Caption]:
    result = await db.execute(
        select(Caption).where(Caption.video_id == video_id).order_by(Caption.sequence)
    )
    return list(result.scalars().all())


async def delete_video(db: AsyncSession, video: Video) -> None:
    """
    Remove the row and its files.

    The row goes first: an orphaned file wastes disk, while a row pointing at
    a missing file breaks playback. Losing the less damaging one is preferable
    if this is interrupted halfway.
    """
    video_id = video.id
    stored, thumbnail = video.storage_path, video.thumbnail_path

    await db.delete(video)
    await db.commit()

    storage.delete(stored)
    storage.delete(thumbnail)
    storage.delete(storage.waveform_cache_path(stored))

    # Caption rows go with the video via ON DELETE CASCADE, but ChromaDB is a
    # separate store with no foreign keys — its vectors must be removed here
    # or searches keep returning hits for a video that no longer exists.
    # Imported lazily so the API process doesn't load the ML stack at startup.
    from app.services.embeddings import delete_video_vectors

    delete_video_vectors(video_id)


async def set_languages(
    db: AsyncSession, video: Video, *, spoken: str | None, caption: str | None
) -> Video:
    """
    Record what to transcribe into, before the job is queued.

    Stored on the video rather than passed with the job so that re-running a
    transcription repeats the choice. Someone pressing "transcribe again" is
    almost always trying to improve the last attempt, and quietly reverting to
    auto-detect would throw away the setting that made it better.

    Each field is only written when supplied, so changing one does not reset
    the other.
    """
    if spoken is not None:
        video.spoken_language = spoken
    if caption is not None:
        video.caption_language = caption

    await db.commit()
    await db.refresh(video)
    return video
