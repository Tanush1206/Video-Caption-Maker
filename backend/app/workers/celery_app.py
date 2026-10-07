from celery import Celery
from celery.signals import worker_ready

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "videocaptionmaker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.workers.transcription",
        "app.workers.export",
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


@worker_ready.connect
def report_hardware(**_kwargs) -> None:
    """
    Tell the API what this machine can run.

    Only the worker container has the GPU passed through, so it is the only
    one that can answer. Written once at startup into app_settings, where the
    Settings page reads it. Failure here must never stop the worker.
    """
    import asyncio
    import json
    import logging

    from app.services import app_settings, hardware
    from app.workers.db import worker_session

    async def write() -> None:
        hw = hardware.detect()
        report = {
            **hw.as_dict(),
            "whisper_default": hardware.whisper_profile(hw).__dict__,
            "translator": hardware.translator_profile(hw).__dict__,
        }
        async with worker_session() as session:
            await app_settings.set_value(session, app_settings.WORKER_HARDWARE, json.dumps(report))

    try:
        asyncio.run(write())
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Could not record worker hardware")
