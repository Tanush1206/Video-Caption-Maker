"""
The "Improve captions with Gemini" job (v1.3.0, services/caption_fix.py).

Reads the captions, asks Gemini batch by batch, keeps the fixes that pass the
checks, and applies them all at the end in one commit, recording each so it
can be undone. A caption edited while the run was going keeps the edit.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from app.config import get_settings
from app.models.caption import Caption
from app.models.caption_fix import ACTIVE_FIX_STATUSES, CaptionFix, CaptionFixRun, FixRunStatus
from app.services import app_settings, caption_fix
from app.services import video as video_service
from app.workers.celery_app import celery_app
from app.workers.db import worker_session

logger = logging.getLogger(__name__)
settings = get_settings()

NO_KEY_MESSAGE = "There's no Gemini key in Settings any more, so the captions weren't checked."
PARTIAL_MESSAGE = "{reason} {done} of {total} parts were checked; their fixes are below."


async def _finish(run_id: int, status: FixRunStatus, message: str | None, fixes: list, dropped: int) -> list[int]:
    """Apply the fixes, record them and close the run, in one commit. Returns the changed caption ids."""
    changed: list[int] = []
    async with worker_session() as db:
        run = await db.get(CaptionFixRun, run_id)
        for caption_id, before, after in fixes:
            caption = await db.get(Caption, caption_id)
            # Edited by hand while the run was going: the person's text wins.
            if caption is None or caption.text != before:
                continue
            caption.text = after
            db.add(CaptionFix(run_id=run_id, caption_id=caption_id, before=before, after=after, undone=False))
            changed.append(caption_id)
        run.status = status.value
        run.error_message = message
        run.dropped = dropped
        run.finished_at = datetime.now(timezone.utc)
        await db.commit()
    return changed


async def _run(run_id: int) -> dict:
    async with worker_session() as db:
        run = await db.get(CaptionFixRun, run_id)
        if run is None or run.status not in ACTIVE_FIX_STATUSES:
            return {"run": run_id, "skipped": True}
        key = await app_settings.gemini_key(db)
        captions = await video_service.list_captions(db, run.video_id)
        run.status = FixRunStatus.RUNNING.value
        run.batches_total = caption_fix.batches(len(captions))
        await db.commit()
        video_id, total = run.video_id, run.batches_total
    if not key:
        await _finish(run_id, FixRunStatus.FAILED, NO_KEY_MESSAGE, [], 0)
        return {"run": run_id, "failed": "no key"}
    if not captions:
        await _finish(run_id, FixRunStatus.COMPLETED, None, [], 0)
        return {"run": run_id, "fixed": 0}

    names = caption_fix.names_in([c.text for c in captions])
    found: list[tuple[int, str, str]] = []
    dropped = 0
    fallback = 0
    # Once the configured model has failed, the rest of the run asks the
    # fallback straight away: a timeout costs up to five minutes a request.
    model = settings.gemini_model
    reason = None
    started = time.monotonic()
    for b in range(total):
        chunk = captions[b * caption_fix.BATCH_SIZE:(b + 1) * caption_fix.BATCH_SIZE]
        texts = [c.text for c in chunk]
        try:
            proposals, used = await asyncio.to_thread(caption_fix.propose, texts, key, model)
        except caption_fix.QuotaExhausted:
            reason = caption_fix.QUOTA_MESSAGE
            break
        except caption_fix.GeminiUnavailable:
            reason = caption_fix.FAILED_MESSAGE
            break
        kept, refused = caption_fix.accept(texts, proposals, names)
        dropped += refused
        fallback += used != settings.gemini_model
        model = used
        found += [(chunk[f.index].id, f.before, f.after) for f in kept]
        async with worker_session() as db:
            run = await db.get(CaptionFixRun, run_id)
            run.batches_done = b + 1
            run.fallback_batches = fallback
            run.seconds_per_batch = (time.monotonic() - started) / (b + 1)
            await db.commit()

    done = b + 1 if reason is None else b
    if reason is None:
        status, message = FixRunStatus.COMPLETED, None
    elif done == 0:
        status, message = FixRunStatus.FAILED, reason
    else:
        # Some parts were checked: keep their fixes, and say what's missing.
        status, message = FixRunStatus.COMPLETED, PARTIAL_MESSAGE.format(reason=reason, done=done, total=total)
    changed = await _finish(run_id, status, message, found, dropped)
    if changed:
        # Search runs on embeddings of the text, as after any caption edit.
        from app.workers.transcription import reindex_captions

        reindex_captions.delay(video_id, changed)
    logger.info("Caption check %s on video %s: %d fixed, %d refused", run_id, video_id, len(changed), dropped)
    return {"run": run_id, "fixed": len(changed), "dropped": dropped}


@celery_app.task(name="improve_captions")
def improve_captions(run_id: int) -> dict:
    return asyncio.run(_run(run_id))
