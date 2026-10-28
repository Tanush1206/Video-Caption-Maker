"""
How the worker is configured to run jobs.

A transcription on a CPU can take longer than the video itself, and a burn at
2160p is allowed three hours. Nothing in Celery's configuration may cut either
short.
"""

from app.services import rendering
from app.workers import export, transcription  # noqa: F401 - registers the tasks
from app.workers.celery_app import celery_app


def test_celery_sets_no_time_limit_that_could_kill_a_long_job():
    assert celery_app.conf.task_time_limit is None
    assert celery_app.conf.task_soft_time_limit is None


def test_no_task_carries_its_own_shorter_limit():
    for name in ("transcribe_video", "render_export", "reindex_captions"):
        task = celery_app.tasks[name]
        assert task.time_limit is None, name
        assert task.soft_time_limit is None, name


def test_the_render_is_bounded_by_its_own_ffmpeg_timeout():
    assert rendering.RENDER_TIMEOUT_SECONDS == 3 * 60 * 60


def test_jobs_run_one_at_a_time_and_survive_a_crash():
    assert celery_app.conf.worker_prefetch_multiplier == 1
    assert celery_app.conf.task_acks_late is True


class _Redis:
    def __init__(self, answers: bool):
        self.answers = answers

    def ping(self):
        if not self.answers:
            raise ConnectionError("no route to redis")
        return True


def test_the_heartbeat_beats_only_while_the_queue_answers(tmp_path, monkeypatch):
    from app.workers import celery_app as worker

    beat = tmp_path / "heartbeat"
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", beat)

    assert worker.beat_once(_Redis(answers=False)) is False
    assert not beat.exists()
    assert worker.beat_once(_Redis(answers=True)) is True
    assert beat.exists()


def test_the_heartbeat_keeps_beating_while_a_job_holds_the_worker(tmp_path, monkeypatch):
    """
    `--pool=solo` runs a job on the worker's own loop, which is why `celery
    inspect ping` went unanswered (and the worker "unhealthy") for as long as
    a job ran. The heartbeat has a thread of its own.
    """
    import time

    import redis

    from app.workers import celery_app as worker

    beat = tmp_path / "heartbeat"
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", beat)
    monkeypatch.setattr(worker, "HEARTBEAT_SECONDS", 0.05)
    monkeypatch.setattr(redis.Redis, "from_url", staticmethod(lambda *a, **k: _Redis(answers=True)))

    stop = worker.start_heartbeat()
    try:
        deadline = time.monotonic() + 2
        while not beat.exists() and time.monotonic() < deadline:
            time.sleep(0.01)  # a job: the calling thread never yields to Celery
        first = beat.stat().st_mtime_ns
        time.sleep(0.3)
        assert beat.stat().st_mtime_ns > first
    finally:
        stop.set()


def test_a_restarted_worker_does_not_count_its_old_heartbeat(tmp_path, monkeypatch):
    from app.workers import celery_app as worker

    beat = tmp_path / "heartbeat"
    beat.touch()
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", beat)
    worker.clear_heartbeat()
    assert not beat.exists()
