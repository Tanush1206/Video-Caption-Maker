"""
The transcription pipeline.

extract audio → transcribe → write captions → embed → index

Runs in the Celery worker, never in an API request: transcribing a 30-minute
video takes minutes, which would time out the HTTP connection and block a
worker the whole time.

The whole task is idempotent — it deletes any existing captions and vectors
for the video before writing new ones — which is what makes it safe to retry
and safe to run with task_acks_late.
"""

import asyncio
import logging
from pathlib import Path

from sqlalchemy import delete, select

from app.models.caption import Caption
from app.models.video import Video, VideoStatus
from app.services import embeddings, storage, transcription
from app.workers.celery_app import celery_app
from app.workers.db import worker_session

logger = logging.getLogger(__name__)

STAGE_EXTRACTING = "extracting"
STAGE_TRANSCRIBING = "transcribing"
STAGE_EMBEDDING = "embedding"


async def _set_progress(video_id: int, stage: str, percent: int) -> None:
    """
    Write progress in its own short-lived session.

    Deliberately separate from the session doing the work: that one holds an
    open transaction for minutes, so anything written through it would be
    invisible to the API until the whole task committed — which is precisely
    when progress stops being interesting.
    """
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            return
        video.stage = stage
        video.progress = max(0, min(percent, 100))
        video.status = VideoStatus.PROCESSING
        await session.commit()


async def _mark_failed(video_id: int, message: str) -> None:
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            return
        video.status = VideoStatus.FAILED
        video.stage = None
        video.progress = 0
        # Truncated: a full traceback in a UI field helps nobody.
        video.error_message = message[:500]
        await session.commit()


async def _run(video_id: int) -> dict:
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            # Deleted while the job sat in the queue. A normal race, not a
            # failure: there is nothing to do and nothing to report.
            logger.info("Video %s was deleted before transcription started", video_id)
            return {"video_id": video_id, "skipped": "video deleted"}
        source_relative = video.storage_path

    source = storage.resolve(source_relative)
    if not source.exists():
        raise RuntimeError("Source video file is missing")

    # Re-running must not duplicate captions or vectors.
    async with worker_session() as session:
        await session.execute(delete(Caption).where(Caption.video_id == video_id))
        await session.commit()
    embeddings.delete_video_vectors(video_id)

    # ── 1. Audio ────────────────────────────────────────────────────────
    await _set_progress(video_id, STAGE_EXTRACTING, 0)
    audio_path = source.with_suffix(".transcode.wav")

    try:
        transcription.extract_audio(source, audio_path)
        await _set_progress(video_id, STAGE_EXTRACTING, 100)

        # ── 2. Transcribe ───────────────────────────────────────────────
        await _set_progress(video_id, STAGE_TRANSCRIBING, 0)

        # transcribe() is blocking and CPU/GPU-bound. It runs on a thread so
        # the progress callback's event loop stays responsive.
        loop = asyncio.get_running_loop()

        def report(percent: int) -> None:
            asyncio.run_coroutine_threadsafe(
                _set_progress(video_id, STAGE_TRANSCRIBING, percent), loop
            )

        segments, language = await asyncio.to_thread(
            transcription.transcribe, audio_path, on_progress=report
        )
        logger.info("Video %s: %d segments (%s)", video_id, len(segments), language)

    finally:
        # The WAV is a large intermediate; drop it however this ends.
        audio_path.unlink(missing_ok=True)

    # ── 3. Persist captions ─────────────────────────────────────────────
    async with worker_session() as session:
        session.add_all(
            [
                Caption(
                    video_id=video_id,
                    sequence=index,
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    text=segment.text,
                    confidence=segment.confidence,
                )
                for index, segment in enumerate(segments)
            ]
        )
        await session.commit()

        caption_ids = list(
            (
                await session.execute(
                    select(Caption.id)
                    .where(Caption.video_id == video_id)
                    .order_by(Caption.sequence)
                )
            ).scalars()
        )

    # ── 4. Embed and index ──────────────────────────────────────────────
    await _set_progress(video_id, STAGE_EMBEDDING, 0)
    try:
        await asyncio.to_thread(embeddings.index_captions, video_id, caption_ids, segments)
    except Exception as exc:  # noqa: BLE001
        # Captions are already saved and useful on their own. A vector store
        # problem degrades search, so it shouldn't fail the whole transcription.
        logger.error("Indexing failed for video %s: %s", video_id, exc)

    # ── Done ────────────────────────────────────────────────────────────
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is not None:
            video.status = VideoStatus.COMPLETED
            video.stage = None
            video.progress = 100
            video.error_message = None
            await session.commit()

    return {"video_id": video_id, "segments": len(segments), "language": language}


@celery_app.task(name="transcribe_video", bind=True)
def transcribe_video(self, video_id: int) -> dict:
    try:
        return asyncio.run(_run(video_id))
    except Exception as exc:
        logger.exception("Transcription failed for video %s", video_id)
        # A video stuck on "processing" forever is worse than an honest
        # failure the user can see and retry.
        asyncio.run(_mark_failed(video_id, str(exc)))
        raise
