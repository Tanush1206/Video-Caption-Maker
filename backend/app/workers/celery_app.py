from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "videocaptionmaker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        # Milestone 4+ will add task modules here, e.g.:
        # "app.workers.transcription",
        # "app.workers.export",
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
)
