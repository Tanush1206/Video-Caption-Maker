"""
Export persistence and sidecar generation.

The burn-in render lives in the worker (app/workers/export.py); everything here
is fast enough to run inside a request.
"""

import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption import Caption
from app.models.caption_style import CaptionStyle
from app.models.export import Export, ExportFormat, ExportStatus
from app.models.video import Video
from app.services import storage, subtitles

SIDECAR_WRITERS = {
    ExportFormat.SRT: subtitles.to_srt,
    ExportFormat.VTT: subtitles.to_vtt,
    ExportFormat.JSON: subtitles.to_json,
}


async def get_owned_export(db: AsyncSession, export_id: int, owner_id: int) -> Export | None:
    """Joins through to the video, so someone else's export is simply not found."""
    result = await db.execute(
        select(Export)
        .join(Video, Export.video_id == Video.id)
        .where(Export.id == export_id, Video.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def list_exports(db: AsyncSession, video_id: int) -> list[Export]:
    result = await db.execute(
        select(Export)
        .where(Export.video_id == video_id)
        .order_by(Export.created_at.desc(), Export.id.desc())
    )
    return list(result.scalars().all())


def build_export_path(video: Video, export_format: ExportFormat) -> tuple[Path, str]:
    """
    Where an export file lives: beside the video, under a fresh UUID.

    A UUID rather than the video's title for the same reason uploads use one —
    the title is user input, and user input must never reach the filesystem.
    The friendly name is applied at download time by Content-Disposition.
    """
    relative = f"user_{video.owner_id}/exports/{uuid.uuid4().hex}.{export_format.value}"
    return storage.resolve(relative), relative


async def create_export(
    db: AsyncSession, video: Video, export_format: ExportFormat
) -> Export:
    export = Export(video_id=video.id, format=export_format, status=ExportStatus.PENDING)
    db.add(export)
    await db.commit()
    await db.refresh(export)
    return export


async def write_sidecar(
    db: AsyncSession, export: Export, video: Video, captions: list[Caption]
) -> Export:
    """
    Generate a text subtitle file and mark the export complete.

    Synchronous on purpose. Even a feature-length transcript is a few hundred
    kilobytes of string formatting — queueing it would mean the UI polls for
    something that finished before the first poll went out.
    """
    absolute, relative = build_export_path(video, export.format)
    absolute.parent.mkdir(parents=True, exist_ok=True)

    content = SIDECAR_WRITERS[export.format](captions)
    # UTF-8 explicitly: players assume it, and the default encoding on the host
    # is not something a subtitle file should depend on.
    absolute.write_text(content, encoding="utf-8")

    export.storage_path = relative
    export.size_bytes = absolute.stat().st_size
    export.status = ExportStatus.COMPLETED
    export.progress = 100
    await db.commit()
    await db.refresh(export)
    return export


async def delete_export(db: AsyncSession, export: Export) -> None:
    stored = export.storage_path
    await db.delete(export)
    await db.commit()
    storage.delete(stored)


async def style_for(db: AsyncSession, video_id: int) -> CaptionStyle:
    """
    The video's style, or an unsaved default.

    Exporting a video nobody has styled must not create a style row as a side
    effect — a GET-shaped operation that writes is a surprise. The defaults are
    read off the columns because an unsaved instance has None in every field.
    """
    from app.services.caption_style import default_style_fields

    result = await db.execute(
        select(CaptionStyle).where(CaptionStyle.video_id == video_id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing

    return CaptionStyle(video_id=video_id, **default_style_fields())
