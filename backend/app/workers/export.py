"""
The burn-in render task.

Runs in the worker because rendering is minutes of CPU per video — the one
thing an HTTP request must never do.

Not idempotent in the way transcription is: each run writes to a fresh UUID
path, so a retry after a crash produces a new file rather than resuming a
half-written one. That is deliberate. A truncated MP4 that looks complete is
worse than a second file on disk.
"""

import asyncio
import logging
import tempfile
from pathlib import Path

from sqlalchemy import select

from app.models.caption import Caption
from app.models.export import Export, ExportStatus
from app.models.video import Video
from app.services import export as export_service
from app.services import media, rendering, storage, subtitles
from app.workers.celery_app import celery_app
from app.workers.db import worker_session

logger = logging.getLogger(__name__)


async def _set_progress(export_id: int, percent: int) -> None:
    """
    Its own short-lived session, for the same reason transcription's is: the
    session doing the work holds a transaction open for minutes, so progress
    written through it would only become visible once the render finished.
    """
    async with worker_session() as session:
        export = await session.get(Export, export_id)
        if export is None:
            return
        export.status = ExportStatus.PROCESSING
        export.progress = max(0, min(percent, 100))
        await session.commit()


async def _mark_failed(export_id: int, message: str) -> None:
    async with worker_session() as session:
        export = await session.get(Export, export_id)
        if export is None:
            return
        export.status = ExportStatus.FAILED
        export.progress = 0
        export.error_message = message[:500]
        await session.commit()


async def _run(export_id: int) -> dict:
    async with worker_session() as session:
        export = await session.get(Export, export_id)
        if export is None:
            logger.info("Export %s was deleted before rendering started", export_id)
            return {"export_id": export_id, "skipped": "export deleted"}

        video = await session.get(Video, export.video_id)
        if video is None:
            logger.info("Video for export %s was deleted", export_id)
            return {"export_id": export_id, "skipped": "video deleted"}

        captions = list(
            (
                await session.execute(
                    select(Caption)
                    .where(Caption.video_id == video.id)
                    .order_by(Caption.sequence)
                )
            )
            .scalars()
            .all()
        )
        style = await export_service.style_for(session, video.id)
        source = storage.resolve(video.storage_path)
        absolute, relative = export_service.build_export_path(video, export.format)
        duration_ms = video.duration_ms

    if not source.exists():
        await _mark_failed(export_id, "The source video file is missing")
        return {"export_id": export_id, "error": "source missing"}

    if not captions:
        await _mark_failed(export_id, "There are no captions to burn in")
        return {"export_id": export_id, "error": "no captions"}

    await _set_progress(export_id, 0)

    # The ASS canvas has to be the real frame size or libass scales everything
    # it draws to the wrong reference and the output stops matching the preview.
    dimensions = await media.probe_dimensions(source)
    if dimensions is None:
        await _mark_failed(export_id, "Could not read the video's dimensions")
        return {"export_id": export_id, "error": "probe failed"}
    width, height = dimensions

    document = subtitles.to_ass(captions, style, width, height)

    # A temporary file rather than a stored one: it is an implementation detail
    # of this render, useless afterwards, and deleting it is automatic.
    with tempfile.TemporaryDirectory() as scratch:
        subtitle_file = Path(scratch) / "captions.ass"
        subtitle_file.write_text(document, encoding="utf-8")

        loop = asyncio.get_running_loop()

        def report(percent: int) -> None:
            # The FFmpeg callback runs on a worker thread; hopping back to the
            # loop is what makes it safe to touch the database from here.
            asyncio.run_coroutine_threadsafe(_set_progress(export_id, percent), loop)

        try:
            await asyncio.to_thread(
                rendering.burn_captions,
                source,
                subtitle_file,
                absolute,
                duration_ms=duration_ms,
                on_progress=report,
            )
        except Exception as exc:  # noqa: BLE001
            await _mark_failed(export_id, str(exc))
            raise

    async with worker_session() as session:
        export = await session.get(Export, export_id)
        if export is None:
            # Deleted mid-render. Clean up rather than orphaning the file.
            absolute.unlink(missing_ok=True)
            return {"export_id": export_id, "skipped": "export deleted"}

        export.storage_path = relative
        export.size_bytes = absolute.stat().st_size
        export.status = ExportStatus.COMPLETED
        export.progress = 100
        await session.commit()

    logger.info("Export %s rendered to %s", export_id, relative)
    return {"export_id": export_id, "path": relative}


@celery_app.task(name="render_export")
def render_export(export_id: int) -> dict:
    return asyncio.run(_run(export_id))
