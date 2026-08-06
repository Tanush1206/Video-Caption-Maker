from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "videocaptionmaker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.workers.transcription",
        # Milestone 8 will add "app.workers.export".
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    # Video processing tasks are long-running — don't let Celery silently
    # kill them via the default time limits.
    task_soft_time_limit=60 * 30,  # 30 min
    task_time_limit=60 * 35,
    # Only take a job when actually free. The default prefetches several, so
    # one worker would sit on queued videos it can't start while another idles.
    worker_prefetch_multiplier=1,
    # Acknowledge only after the task finishes, so a crashed worker's job is
    # redelivered rather than lost. Safe because the pipeline is idempotent:
    # it deletes any existing captions before writing new ones.
    task_acks_late=True,
)
