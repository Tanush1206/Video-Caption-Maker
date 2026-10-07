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
from concurrent.futures import Future
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
        # Never walk a finished export backwards. The caller drains these
        # before writing the final status, so this should not trigger — it is
        # here because the cost of being wrong is an export stuck on
        # "rendering" with its download disabled, and the check is one compare.
        if export.status in (ExportStatus.COMPLETED, ExportStatus.FAILED):
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
        requested_height = export.height

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
    source_width, source_height = dimensions

    # The *output* size, not the source's — and this is the whole reason a
    # resolution option is worth having. The scale filter runs before libass, so
    # the captions are drawn at the size below; telling libass the source's size
    # instead would make it draw them for a 144p canvas and then let FFmpeg
    # stretch the result, which is the blurry text the option exists to fix.
    width, height = rendering.target_dimensions(
        source_width, source_height, requested_height
    )
    resize = (width, height) if (width, height) != (source_width, source_height) else None

    document = subtitles.to_ass(captions, style, width, height)

    # A temporary file rather than a stored one: it is an implementation detail
    # of this render, useless afterwards, and deleting it is automatic.
    with tempfile.TemporaryDirectory() as scratch:
        subtitle_file = Path(scratch) / "captions.ass"
        subtitle_file.write_text(document, encoding="utf-8")

        loop = asyncio.get_running_loop()

        # Every progress write, so they can be waited on before the final one.
        #
        # Without this the task has a lost-update race it loses often enough to
        # matter: a progress write scheduled just before FFmpeg exits reads the
        # row, the completion block then writes COMPLETED, and the progress
        # write commits PROCESSING on top of it. The export is finished, the
        # file is on disk, and the UI polls a row that says "rendering" forever
        # with the download button disabled.
        #
        # Draining is enough because no new callbacks can arrive once
        # `burn_captions` has returned — FFmpeg has exited and the pipe is
        # closed, so this list is complete and finite by then.
        progress_writes: list[Future] = []

        def report(percent: int) -> None:
            # The FFmpeg callback runs on a worker thread; hopping back to the
            # loop is what makes it safe to touch the database from here.
            progress_writes.append(
                asyncio.run_coroutine_threadsafe(_set_progress(export_id, percent), loop)
            )

        try:
            await asyncio.to_thread(
                rendering.burn_captions,
                source,
                subtitle_file,
                absolute,
                duration_ms=duration_ms,
                target=resize,
                on_progress=report,
            )
        except Exception as exc:  # noqa: BLE001
            await _mark_failed(export_id, str(exc))
            raise
        finally:
            # In `finally` so a failed render drains them too — otherwise a
            # late progress write lands on top of FAILED and hides the error
            # message the user needs to see.
            if progress_writes:
                await asyncio.gather(
                    *(asyncio.wrap_future(write) for write in progress_writes),
                    return_exceptions=True,
                )

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
