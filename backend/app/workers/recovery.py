"""
Picking up jobs a restart dropped.

Redis is the queue and runs without persistence (see docker-compose.prod.yml),
so a reboot or `vcm restart` during processing loses the task — queued or
half-done. The database still says "processing", the API refuses to requeue a
video that is processing, and the user is left with a spinner that never ends.

So when the worker starts, every video or export the database calls pending or
processing, and that the broker no longer holds, is queued again. Both
pipelines are idempotent (transcription replaces a video's captions; a render
writes a fresh file), so the cost of a rerun is time, not corrupt data.

Assumes one worker node, which is what the install runs: at startup it is
working on nothing, so anything "processing" is stranded rather than in
progress elsewhere.
"""

import ast
import base64
import json
import logging

from sqlalchemy import select

from app.models.export import Export, ExportStatus
from app.models.video import Video, VideoStatus

logger = logging.getLogger(__name__)

TASK_FOR = {"transcribe_video": "video", "render_export": "export"}
QUEUE = "celery"
UNACKED = "unacked"


def _job_of(message: dict) -> tuple[str, int] | None:
    """('video', 11) for a transcribe_video(11) message; None for anything else."""
    headers = message.get("headers") or {}
    kind = TASK_FOR.get(headers.get("task"))
    if kind is None:
        return None
    args = None
    try:
        args = ast.literal_eval(headers.get("argsrepr") or "")
    except (ValueError, SyntaxError):
        pass
    if not args:
        try:
            body = message.get("body", "")
            if (message.get("properties") or {}).get("body_encoding") == "base64":
                body = base64.b64decode(body)
            args = json.loads(body)[0]
        except (ValueError, TypeError, IndexError, KeyError):
            return None
    try:
        return kind, int(args[0])
    except (TypeError, ValueError, IndexError):
        return None


def jobs_in_broker(client) -> set[tuple[str, int]]:
    """Every video/export job the broker still holds, queued or delivered-but-unacked."""
    raw = list(client.lrange(QUEUE, 0, -1))
    # An unacked entry is [message, exchange, routing_key].
    raw += list(client.hvals(UNACKED))
    jobs = set()
    for item in raw:
        try:
            message = json.loads(item)
        except (ValueError, TypeError):
            continue
        if isinstance(message, list) and message:
            message = message[0]
        if isinstance(message, dict) and (job := _job_of(message)):
            jobs.add(job)
    return jobs


async def stranded(session, held: set[tuple[str, int]]) -> tuple[list[int], list[int]]:
    """Ids of unfinished videos and exports that no queued message will run."""
    unfinished_videos = await session.scalars(
        select(Video.id).where(Video.status.in_([VideoStatus.PENDING, VideoStatus.PROCESSING]))
    )
    unfinished_exports = await session.scalars(
        select(Export.id).where(Export.status.in_([ExportStatus.PENDING, ExportStatus.PROCESSING]))
    )
    videos = [i for i in unfinished_videos if ("video", i) not in held]
    exports = [i for i in unfinished_exports if ("export", i) not in held]
    return videos, exports


async def requeue_stranded(client) -> tuple[list[int], list[int]]:
    """Queue every stranded job again. Returns what was requeued."""
    from app.workers.db import worker_session
    from app.workers.export import render_export
    from app.workers.transcription import transcribe_video

    held = jobs_in_broker(client)
    async with worker_session() as session:
        videos, exports = await stranded(session, held)
    for video_id in videos:
        transcribe_video.delay(video_id)
    for export_id in exports:
        render_export.delay(export_id)
    if videos or exports:
        logger.info(
            "Requeued work a restart interrupted: videos %s, exports %s", videos, exports
        )
    return videos, exports
