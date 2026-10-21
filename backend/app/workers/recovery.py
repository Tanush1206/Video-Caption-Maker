"""
Picking up jobs a restart dropped.

Redis is the queue and runs without persistence (see docker-compose.prod.yml),
so a reboot or `vcm restart` during processing loses the task — queued or
half-done. The database still says "processing", the API refuses to requeue a
video that is processing, and the user is left with a spinner that never ends.

So when the worker starts, every video or export the database calls pending or
processing, and that is not waiting in the queue, is queued again, up to
MAX_REQUEUES times; after that it is failed with a reason the user can act
on. Both pipelines are idempotent (transcription replaces a video's
captions; a render writes a fresh file), so the cost of a rerun is time, not
corrupt data.

Assumes one worker node, which is what the install runs: at startup it is
working on nothing, so anything "processing", and anything Redis holds as
delivered-but-unacknowledged, is stranded rather than in progress elsewhere.
"""

import ast
import base64
import json
import logging
from dataclasses import dataclass, field

from sqlalchemy import select

from app.models.export import Export, ExportStatus
from app.models.video import Video, VideoStatus

logger = logging.getLogger(__name__)

TASK_FOR = {"transcribe_video": "video", "render_export": "export"}

# Automatic requeues before a job is failed instead. A job that takes the
# worker down with it (out of memory on a small machine, most often) would
# otherwise be requeued, and take it down again, on every start.
MAX_REQUEUES = 3

VIDEO_GAVE_UP = (
    "Processing was interrupted several times without finishing, which usually "
    "means the computer ran out of memory. Choose a smaller speech model in "
    "Settings, then try again."
)
EXPORT_GAVE_UP = (
    "Rendering was interrupted several times without finishing, which usually "
    "means the computer ran out of memory. Close other programs, then export again."
)
QUEUE = "celery"
UNACKED = "unacked"
UNACKED_INDEX = "unacked_index"


@dataclass
class Recovery:
    videos: list[int] = field(default_factory=list)
    exports: list[int] = field(default_factory=list)
    failed_videos: list[int] = field(default_factory=list)
    failed_exports: list[int] = field(default_factory=list)


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


def _parse(item) -> dict | None:
    try:
        message = json.loads(item)
    except (ValueError, TypeError):
        return None
    # An unacked entry is [message, exchange, routing_key].
    if isinstance(message, list) and message:
        message = message[0]
    return message if isinstance(message, dict) else None


def jobs_in_broker(client) -> set[tuple[str, int]]:
    """Every video/export job waiting in the queue, not yet delivered."""
    jobs = set()
    for item in client.lrange(QUEUE, 0, -1):
        message = _parse(item)
        if message and (job := _job_of(message)):
            jobs.add(job)
    return jobs


def take_over_unacked(client) -> set[tuple[str, int]]:
    """
    Claim what the worker that died had been given but never finished.

    With acks_late, a job delivered to a worker stays in Redis's unacked set
    until the task returns. If the worker is killed mid-job (out of memory),
    the job sits there until the visibility timeout, an hour, and is then
    redelivered behind the counter's back: the crash loop, slowed down. With
    one worker, anything unacked at its start belonged to the one that died.

    Video and export jobs are removed, and left to recover() and its counter.
    Anything else is put back on its queue, as Redis would have done.
    """
    taken = set()
    for tag, item in client.hgetall(UNACKED).items():
        message = _parse(item)
        job = _job_of(message) if message else None
        if job is None and message is not None:
            try:
                routing_key = json.loads(item)[2] or QUEUE
            except (ValueError, TypeError, IndexError):
                routing_key = QUEUE
            client.lpush(routing_key, json.dumps(message))
        client.hdel(UNACKED, tag)
        client.zrem(UNACKED_INDEX, tag)
        if job:
            taken.add(job)
    return taken


async def recover(session, held: set[tuple[str, int]]) -> Recovery:
    """
    Decide, and record, what happens to each unfinished job the broker lost.

    Requeued while it has attempts left; failed with a reason once it has been
    requeued MAX_REQUEUES times, because by then it is most likely the job
    itself that keeps taking the worker down. Committed before anything is
    queued, so a job that crashes the worker straight away still used up an
    attempt.
    """
    result = Recovery()
    videos = await session.scalars(
        select(Video).where(
            Video.status.in_([VideoStatus.PENDING, VideoStatus.PROCESSING]),
            # An upload waiting on the language step was never started: queuing
            # it would transcribe a video nobody has said how to caption.
            Video.held.is_(False),
        )
    )
    for video in videos:
        if ("video", video.id) in held:
            continue
        if video.recovery_attempts >= MAX_REQUEUES:
            video.status = VideoStatus.FAILED
            video.stage = None
            video.stage_detail = None
            video.progress = 0
            video.error_message = VIDEO_GAVE_UP
            result.failed_videos.append(video.id)
        else:
            video.recovery_attempts += 1
            result.videos.append(video.id)

    exports = await session.scalars(
        select(Export).where(Export.status.in_([ExportStatus.PENDING, ExportStatus.PROCESSING]))
    )
    for export in exports:
        if ("export", export.id) in held:
            continue
        if export.recovery_attempts >= MAX_REQUEUES:
            export.status = ExportStatus.FAILED
            export.progress = 0
            export.error_message = EXPORT_GAVE_UP
            result.failed_exports.append(export.id)
        else:
            export.recovery_attempts += 1
            result.exports.append(export.id)

    await session.commit()
    return result


async def requeue_stranded(client) -> Recovery:
    """Requeue (or give up on) every stranded job. Returns what was done."""
    from app.workers.db import worker_session
    from app.workers.export import render_export
    from app.workers.transcription import transcribe_video

    taken = take_over_unacked(client)
    if taken:
        logger.info("Took over jobs the previous worker never finished: %s", sorted(taken))
    held = jobs_in_broker(client)
    async with worker_session() as session:
        result = await recover(session, held)
    for video_id in result.videos:
        transcribe_video.delay(video_id)
    for export_id in result.exports:
        render_export.delay(export_id)
    if result.videos or result.exports:
        logger.info(
            "Requeued work a restart interrupted: videos %s, exports %s",
            result.videos, result.exports,
        )
    if result.failed_videos or result.failed_exports:
        logger.warning(
            "Gave up on work interrupted %d times: videos %s, exports %s",
            MAX_REQUEUES + 1, result.failed_videos, result.failed_exports,
        )
    return result
