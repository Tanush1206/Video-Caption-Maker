"""
Jobs a restart dropped are picked up again when the worker starts.

Redis runs without persistence, so a reboot during processing used to leave a
video on "processing" forever, with retry refused because it was processing.
"""

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


def test_reads_delivered_but_unacknowledged_jobs(spare_broker):
    """An unacked entry wraps the message as [message, exchange, routing_key]."""
    url, client = spare_broker
    Celery("probe", broker=url).send_task("transcribe_video", args=[42])
    message = client.lpop(recovery.QUEUE)
    client.hset(recovery.UNACKED, "tag-1", b'[' + message + b', "", "celery"]')

    assert recovery.jobs_in_broker(client) == {("video", 42)}


async def test_only_unfinished_work_the_broker_lost_is_stranded(
    client, auth_headers, sample_video_bytes, db_session
):
    from app.models.video import Video, VideoStatus

    ids = []
    for _ in range(3):
        response = await client.post(
            "/api/videos",
            headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
        ids.append(response.json()["id"])
    lost, still_queued, finished = ids
    (await db_session.get(Video, lost)).status = VideoStatus.PROCESSING
    (await db_session.get(Video, finished)).status = VideoStatus.COMPLETED
    await db_session.commit()

    videos, _ = await recovery.stranded(db_session, held={("video", still_queued)})

    assert lost in videos
    assert still_queued not in videos
    assert finished not in videos
