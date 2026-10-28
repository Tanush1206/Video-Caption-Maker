import logging
import threading
from pathlib import Path

from celery import Celery
from celery.signals import worker_init, worker_ready

from app.config import get_settings

# httpx logs every request at INFO, which buries the pipeline's own lines
# under hundreds of Hugging Face and ChromaDB round trips.
logging.getLogger("httpx").setLevel(logging.WARNING)

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
    # No Celery time limits. They used to be 30/35 minutes, which would kill
    # a long CPU transcription or a multi-hour render partway through, except
    # that the worker runs `--pool=solo`, which never enforces them (measured:
    # a 6 s task under a 3 s hard limit ran to completion). The numbers
    # promised a cut-off that didn't exist, and would have started cutting off
    # real work the day the pool changed. What bounds a job is the step that
    # could hang: FFmpeg renders time out after RENDER_TIMEOUT_SECONDS (3 h),
    # and every probe and extraction subprocess has its own timeout.
    task_soft_time_limit=None,
    task_time_limit=None,
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
    Settings page and the export panel read it. Failure here must never stop
    the worker.

    `nvenc` included since v1.2.0: the export panel used to ask the API's own
    process, which has no GPU, so "GPU encoding." never showed.
    """
    import asyncio
    import json
    import logging

    from app.services import app_settings, hardware, rendering
    from app.workers.db import worker_session

    async def write() -> None:
        hw = hardware.detect()
        report = {
            **hw.as_dict(),
            "whisper_default": hardware.whisper_profile(hw).__dict__,
            "translator": hardware.translator_profile(hw).__dict__,
            "nvenc": rendering.nvenc_available(),
        }
        async with worker_session() as session:
            await app_settings.set_value(session, app_settings.WORKER_HARDWARE, json.dumps(report))

    try:
        asyncio.run(write())
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Could not record worker hardware")


# The worker's health check (docker-compose.prod.yml) passes while this file
# is less than a minute old.
HEARTBEAT_FILE = Path("/tmp/vcm-worker-heartbeat")
HEARTBEAT_SECONDS = 15


def beat_once(client) -> bool:
    """Touch the heartbeat file if Redis, the job queue, answers."""
    try:
        client.ping()
        HEARTBEAT_FILE.touch()
    except Exception:  # noqa: BLE001 - a missed beat is the signal
        return False
    return True


@worker_init.connect
def clear_heartbeat(**_kwargs) -> None:
    """A restarted container keeps its /tmp: no beat counts until this run's."""
    HEARTBEAT_FILE.unlink(missing_ok=True)


@worker_ready.connect
def start_heartbeat(**_kwargs) -> threading.Event:
    """
    Beat every 15 s from a thread of its own, so a busy worker stays healthy.

    The health check was `celery inspect ping`, which `--pool=solo` answers
    from the loop that runs tasks: every long transcription or burn showed the
    worker as unhealthy until it finished (to v1.1.1). The thread keeps
    beating during a task; each beat pings Redis first, so a worker cut off
    from its queue still shows unhealthy. Returns the event that stops it.
    """
    import redis

    client = redis.Redis.from_url(settings.redis_url, socket_timeout=5)
    stop = threading.Event()

    def run() -> None:
        while not stop.is_set():
            beat_once(client)
            stop.wait(HEARTBEAT_SECONDS)

    threading.Thread(target=run, name="vcm-heartbeat", daemon=True).start()
    return stop


@worker_ready.connect
def requeue_interrupted(**_kwargs) -> None:
    """Restart jobs a reboot or restart dropped; see workers/recovery.py."""
    import asyncio
    import logging

    import redis

    from app.workers import recovery

    try:
        client = redis.Redis.from_url(settings.redis_url)
        asyncio.run(recovery.requeue_stranded(client))
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("Could not requeue interrupted work")
