"""Video persistence. Ownership is enforced here, not left to callers."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    db: AsyncSession, owner_id: int, *, limit: int = 50, offset: int = 0
) -> tuple[list[Video], int]:
    """Newest first, with the total count for pagination."""
    total = await db.scalar(
        select(func.count()).select_from(Video).where(Video.owner_id == owner_id)
    )

    result = await db.execute(
        select(Video)
        .where(Video.owner_id == owner_id)
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


async def delete_video(db: AsyncSession, video: Video) -> None:
    """
    Remove the row and its files.

    The row goes first: an orphaned file wastes disk, while a row pointing at
    a missing file breaks playback. Losing the less damaging one is preferable
    if this is interrupted halfway.
    """
    stored, thumbnail = video.storage_path, video.thumbnail_path

    await db.delete(video)
    await db.commit()

    storage.delete(stored)
    storage.delete(thumbnail)
