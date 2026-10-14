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
