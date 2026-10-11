"""
Jobs a restart dropped are picked up again when the worker starts.

Redis runs without persistence, so a reboot during processing used to leave a
video on "processing" forever, with retry refused because it was processing.
"""

import json

import pytest
import redis
from celery import Celery

from app.config import get_settings
from app.workers import recovery

# A database no worker listens on, so the messages sent here stay put.
SPARE_DB = 15


@pytest.fixture
def spare_broker():
    url = get_settings().redis_url.rsplit("/", 1)[0] + f"/{SPARE_DB}"
    client = redis.Redis.from_url(url)
    client.flushdb()
    yield url, client
    client.flushdb()


def test_reads_the_jobs_celery_actually_queued(spare_broker):
    """Parsed from real Celery messages, not a hand-built imitation of one."""
    url, client = spare_broker
    sender = Celery("probe", broker=url)
    sender.send_task("transcribe_video", args=[11])
    sender.send_task("render_export", args=[7])
    sender.send_task("reindex_captions", args=[3])

    assert recovery.jobs_in_broker(client) == {("video", 11), ("export", 7)}


def _deliver_and_crash(client, url, task, args, tag):
    """What a worker killed mid-task leaves: its message in the unacked set."""
    Celery("probe", broker=url).send_task(task, args=args)
    message = client.lpop(recovery.QUEUE)
    client.hset(recovery.UNACKED, tag, b"[" + message + b', "", "celery"]')
    client.zadd(recovery.UNACKED_INDEX, {tag: 1.0})


def test_a_job_the_dead_worker_held_is_taken_over_not_left_for_an_hour(spare_broker):
    """
    Found with a real OOM kill: the job sat in Redis's unacked set, so it was
    not "stranded", and Redis would have redelivered it an hour later,
    outside the attempt counter. Taken over at startup instead; anything that
    is not a video or export goes back on the queue untouched.
    """
    url, client = spare_broker
    _deliver_and_crash(client, url, "transcribe_video", [42], "tag-1")
    _deliver_and_crash(client, url, "reindex_captions", [5], "tag-2")

    taken = recovery.take_over_unacked(client)

    assert taken == {("video", 42)}
    assert client.hlen(recovery.UNACKED) == 0
    assert client.zcard(recovery.UNACKED_INDEX) == 0
    # The video job is left to recover() and its counter, so it is not
    # "held": nothing in the queue will run it.
    assert ("video", 42) not in recovery.jobs_in_broker(client)
    requeued = [json.loads(m)["headers"]["task"] for m in client.lrange(recovery.QUEUE, 0, -1)]
    assert requeued == ["reindex_captions"]


async def _upload(client, auth_headers, sample_video_bytes) -> int:
    response = await client.post(
        "/api/videos",
        headers=auth_headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
    )
    return response.json()["id"]


async def test_only_unfinished_work_the_broker_lost_is_requeued(
    client, auth_headers, sample_video_bytes, db_session
):
    from app.models.video import Video, VideoStatus

    lost, still_queued, finished = [
        await _upload(client, auth_headers, sample_video_bytes) for _ in range(3)
    ]
    (await db_session.get(Video, lost)).status = VideoStatus.PROCESSING
    (await db_session.get(Video, finished)).status = VideoStatus.COMPLETED
    await db_session.commit()

    result = await recovery.recover(db_session, held={("video", still_queued)})

    assert lost in result.videos
    assert still_queued not in result.videos
    assert finished not in result.videos
    db_session.expire_all()
    assert (await db_session.get(Video, lost)).recovery_attempts == 1
    assert (await db_session.get(Video, still_queued)).recovery_attempts == 0


async def test_a_job_that_keeps_crashing_the_worker_is_failed_not_requeued_forever(
    client, auth_headers, sample_video_bytes, db_session
):
    """
    Each worker start finds the video still "processing" (the crash left it so)
    and requeues it, up to MAX_REQUEUES times. The next start fails it with a
    reason, and a manual retry gets a fresh allowance.
    """
    from app.models.video import Video, VideoStatus

    video_id = await _upload(client, auth_headers, sample_video_bytes)
    (await db_session.get(Video, video_id)).status = VideoStatus.PROCESSING
    await db_session.commit()

    for attempt in range(1, recovery.MAX_REQUEUES + 1):
        result = await recovery.recover(db_session, held=set())
        assert video_id in result.videos, f"start {attempt} should requeue"
        # The requeued job crashes the worker again: still processing.
        video = await db_session.get(Video, video_id)
        assert video.recovery_attempts == attempt
        video.status = VideoStatus.PROCESSING
        await db_session.commit()

    result = await recovery.recover(db_session, held=set())

    assert video_id not in result.videos
    assert video_id in result.failed_videos
    db_session.expire_all()
    video = await db_session.get(Video, video_id)
    assert video.status == VideoStatus.FAILED
    assert "smaller speech model" in video.error_message

    # The user retries by hand: allowed, and the count starts over.
    response = await client.post(f"/api/videos/{video_id}/transcribe", headers=auth_headers)
    assert response.status_code == 200
    db_session.expire_all()
    assert (await db_session.get(Video, video_id)).recovery_attempts == 0


async def test_an_export_that_keeps_crashing_the_worker_is_failed(
    client, auth_headers, sample_video_bytes, db_session
):
    from app.models.export import Export, ExportFormat, ExportStatus

    video_id = await _upload(client, auth_headers, sample_video_bytes)
    export = Export(
        video_id=video_id,
        format=ExportFormat.MP4,
        status=ExportStatus.PROCESSING,
        recovery_attempts=recovery.MAX_REQUEUES,
    )
    db_session.add(export)
    await db_session.commit()
    export_id = export.id

    result = await recovery.recover(db_session, held=set())

    assert export_id in result.failed_exports
    assert export_id not in result.exports
    db_session.expire_all()
    failed = await db_session.get(Export, export_id)
    assert failed.status == ExportStatus.FAILED
    assert "ran out of memory" in failed.error_message
