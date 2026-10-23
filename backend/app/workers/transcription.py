"""
The transcription pipeline.

extract audio → transcribe → write captions → embed → index

Runs in the Celery worker, never in an API request: transcribing a 30-minute
video takes minutes, which would time out the HTTP connection and block a
worker the whole time.

The whole task is idempotent — it deletes any existing captions and vectors
for the video before writing new ones — which is what makes it safe to retry
and safe to run with task_acks_late.
"""

import asyncio
import logging

from sqlalchemy import delete, select

from app.models.caption import Caption
from app.models.video import Video, VideoStatus
from app.services import (
    app_settings,
    embeddings,
    hardware,
    hinglish,
    languages,
    model_store,
    phrasing,
    storage,
    transcription,
    translation,
)
from app.services import caption as caption_service
from app.workers.celery_app import celery_app
from app.workers.db import worker_session

logger = logging.getLogger(__name__)

# Fetching model weights — only ever on the first job after an install, or
# after switching models in Settings.
STAGE_DOWNLOADING = "downloading"
STAGE_EXTRACTING = "extracting"
STAGE_TRANSCRIBING = "transcribing"
STAGE_TRANSLATING = "translating"
STAGE_EMBEDDING = "embedding"


async def _set_progress(
    video_id: int, stage: str, percent: int, detail: str | None = None
) -> None:
    """
    Write progress in its own short-lived session.

    Deliberately separate from the session doing the work: that one holds an
    open transaction for minutes, so anything written through it would be
    invisible to the API until the whole task committed — which is precisely
    when progress stops being interesting.
    """
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            return
        video.stage = stage
        video.progress = max(0, min(percent, 100))
        video.stage_detail = detail
        video.status = VideoStatus.PROCESSING
        await session.commit()


async def _mark_failed(video_id: int, message: str) -> None:
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            return
        video.status = VideoStatus.FAILED
        video.stage = None
        video.stage_detail = None
        video.progress = 0
        # Truncated: a full traceback in a UI field helps nobody.
        video.error_message = message[:500]
        await session.commit()


def _gb(n: int) -> str:
    return f"{n / 1024**3:.1f}"


def _download_reporter(video_id: int, loop, label: str):
    """A thread-safe on_progress for model_store that writes the download stage."""

    def report(done: int, total: int) -> None:
        percent = round(done / total * 100) if total else 0
        detail = (
            f"Downloading {label} · {_gb(done)} of {_gb(total)} GB"
            if total
            else f"Downloading {label}"
        )
        asyncio.run_coroutine_threadsafe(
            _set_progress(video_id, STAGE_DOWNLOADING, percent, detail), loop
        )

    return report


def friendly_error(exc: BaseException) -> str:
    """
    What to tell the user about a failed job.

    The raw exception goes to the log; the video gets a sentence that says
    what happened and what to try. A CUDA stack trace in the UI helps nobody.
    """
    if isinstance(exc, model_store.ModelDownloadError):
        return str(exc)
    message = str(exc).lower()
    if "out of memory" in message or isinstance(exc, MemoryError):
        return (
            "Ran out of memory while transcribing. Choose a smaller speech model in "
            "Settings, or close other heavy apps, then try again."
        )
    if "no space left" in message or "errno 28" in message:
        return "The disk is full. Free some space, then try again."
    if "no audio" in message or "audio stream" in message:
        return "This video has no audio track, so there is nothing to caption."
    if "source video file is missing" in message:
        return "The uploaded file is missing. Upload the video again."
    if "invalid data" in message or "ffmpeg" in message or "decod" in message:
        return "This file couldn't be read as a video. Try converting it to MP4 and upload it again."
    return "Transcription failed unexpectedly. Try again; if it keeps failing, check the logs."


async def _run(video_id: int, keep_breaks: bool = False) -> dict:
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            # Deleted while the job sat in the queue. A normal race, not a
            # failure: there is nothing to do and nothing to report.
            logger.info("Video %s was deleted before transcription started", video_id)
            return {"video_id": video_id, "skipped": "video deleted"}
        source_relative = video.storage_path
        spoken = video.spoken_language or languages.AUTO
        wanted = video.caption_language or languages.SAME
        chosen_script = video.hindi_script
        video.notice = None
        await session.commit()

        # Read per job, not per process: Settings can change between jobs.
        whisper_choice = await app_settings.whisper_override(session)
        gemini_key = await app_settings.gemini_key(session)

    source = storage.resolve(source_relative)
    if not source.exists():
        raise RuntimeError("Source video file is missing")

    # Re-running must not duplicate captions or vectors. A Redo in the same
    # caption language keeps the manual line breaks of any caption that comes
    # out with exactly the same words (`keep_breaks`, set by the route).
    async with worker_session() as session:
        breaks: dict[str, tuple[int, ...]] = {}
        if keep_breaks:
            old = (await session.execute(select(Caption).where(Caption.video_id == video_id))).scalars()
            breaks = caption_service.saved_breaks(list(old))
        await session.execute(delete(Caption).where(Caption.video_id == video_id))
        await session.commit()
    embeddings.delete_video_vectors(video_id)

    loop = asyncio.get_running_loop()
    notices: list[str] = []

    # ── 0. Model ────────────────────────────────────────────────────────
    # First, so a download shows as a download rather than as a transcription
    # stuck at 0%. A no-op when the weights are cached and already loaded.
    profile = hardware.whisper_profile(hardware.detect(), whisper_choice)
    await _set_progress(video_id, STAGE_DOWNLOADING, 0, f"Preparing speech model {profile.model}")
    await asyncio.to_thread(
        transcription.load_model,
        profile,
        _download_reporter(video_id, loop, f"speech model {profile.model}"),
    )
    if transcription.fallback_note:
        notices.append(transcription.fallback_note)

    # ── 1. Audio ────────────────────────────────────────────────────────
    await _set_progress(video_id, STAGE_EXTRACTING, 0)
    audio_path = source.with_suffix(".transcode.wav")

    try:
        transcription.extract_audio(source, audio_path)
        await _set_progress(video_id, STAGE_EXTRACTING, 100)

        # ── 2. Transcribe ───────────────────────────────────────────────
        await _set_progress(video_id, STAGE_TRANSCRIBING, 0)

        # transcribe() is blocking and CPU/GPU-bound. It runs on a thread so
        # the progress callback's event loop stays responsive.

        def report(percent: int) -> None:
            asyncio.run_coroutine_threadsafe(
                _set_progress(video_id, STAGE_TRANSCRIBING, percent), loop
            )

        # Detect first, in its own pass, because the task below has to be
        # chosen before transcribing and it depends on what is being spoken:
        # asking for English captions on English audio should transcribe, not
        # take Whisper's translate path to arrive where it already was.
        #
        # One encoder pass over thirty seconds, against minutes for the
        # transcription it precedes.
        detected_now = spoken == languages.AUTO
        if detected_now:
            hint, confidence = await asyncio.to_thread(
                transcription.detect_language, audio_path
            )
            logger.info("Video %s: heard %s (%.2f)", video_id, hint, confidence)
        else:
            # Named by the person: as sure as it gets.
            hint, confidence = spoken, 1.0

        # Hindi in Roman script comes from its own model (services/hinglish.py).
        # Not for English captions: those are Whisper's own translation, which
        # reads far better than anything M2M100 makes of either script.
        script = (
            languages.hindi_script_for(chosen_script, hint, confidence)
            if hint == "hi"
            else None
        )
        roman = script == languages.ROMAN and wanted != "en"
        if roman:
            profile = hardware.hinglish_profile(hardware.detect())
            await _set_progress(video_id, STAGE_DOWNLOADING, 0, "Preparing the Hinglish speech model")
            await asyncio.to_thread(
                transcription.load_model,
                profile,
                _download_reporter(video_id, loop, "the Hinglish speech model (first use only)"),
            )
            await _set_progress(video_id, STAGE_TRANSCRIBING, 0)

        segments, language = await asyncio.to_thread(
            transcription.transcribe,
            audio_path,
            # Apex writes Hinglish under Whisper's English token, as its card says.
            language=hinglish.APEX_LANGUAGE if roman else hint,
            # "translate" is Whisper's English-only path, taken in this same
            # pass when English is what was asked for. Anything else is
            # translated after the fact, below. Decided on the hint rather than
            # the raw setting, so "auto" on English audio does not take the
            # translate path to reach English.
            task="transcribe" if roman else languages.whisper_task(hint, wanted),
            on_progress=report,
        )
        if roman:
            # It is Hindi, whatever token it was decoded under.
            language = "hi"
        logger.info("Video %s: %d segments (%s)", video_id, len(segments), language)
        if transcription.low_confidence_note:
            notices.append(transcription.low_confidence_note)
        if not segments:
            notices.append(transcription.NO_SPEECH_NOTICE)

    finally:
        # The WAV is a large intermediate; drop it however this ends.
        audio_path.unlink(missing_ok=True)

    # ── 2b. Translate, if the target isn't what was spoken ──────────────
    #
    # English never reaches here: Whisper produced it directly above, in the
    # same pass, because `task="translate"` is English-only. This is the path
    # for the other four languages.
    #
    # Skipped when Whisper already reported the target language — asking a
    # model to translate Hindi into Hindi is a round trip that can only make
    # the text worse.
    if segments and wanted not in (languages.SAME, "en") and language != wanted:
        await _set_progress(video_id, STAGE_TRANSLATING, 0)

        def report_translation(percent: int) -> None:
            asyncio.run_coroutine_threadsafe(
                _set_progress(video_id, STAGE_TRANSLATING, percent), loop
            )

        texts = [segment.text for segment in segments]
        if roman:
            # M2M100 can't read Roman Hinglish (it copies it through, or
            # invents something), so it gets Devanagari: measured, PROGRESS.md
            # v1.0.9. Gemini gets the same, until it is measured on Roman.
            texts = await asyncio.to_thread(
                hinglish.to_devanagari,
                texts,
                _download_reporter(video_id, loop, "the Hindi transliterator (first use only)"),
            )
        result = await asyncio.to_thread(
            translation.translate_texts,
            texts,
            wanted,
            source=language,
            api_key=gemini_key or None,
            on_progress=report_translation,
            on_download=_download_reporter(video_id, loop, "translation model"),
        )
        if result is None:
            # Deliberately not fatal. The captions exist, they are correctly
            # timed, and they are in the language that was actually spoken —
            # which is worse than what was asked for and far better than
            # failing the whole transcription and leaving the video with none.
            logger.error(
                "Video %s: could not translate captions to %s; keeping %s",
                video_id, wanted, language,
            )
            notices.append(
                f"Couldn't translate into {languages.label(wanted)}, so the captions are in "
                f"the spoken language ({languages.label(language)})."
            )
        else:
            if result.notice:
                notices.append(result.notice)
            # Timings are untouched on purpose: a translated line has a
            # different length, and re-timing it would be guesswork against
            # audio nothing here has listened to.
            segments = [
                transcription.Segment(
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    text=text,
                    confidence=segment.confidence,
                    # The speech is still the speech: the translated captions
                    # are timed to it (services/phrasing.py).
                    speech=segment.speech,
                )
                for segment, text in zip(segments, result.texts)
            ]
            logger.info(
                "Video %s: translated %d captions to %s (%s)",
                video_id, len(segments), wanted, result.engine,
            )

    # The word timings the captions are made from, kept with the video.
    spoken = [
        [s, e] for segment in segments for s, e, w in getattr(segment, "speech", None) or [] if w and e > s
    ]

    # ── 3. Phrases ──────────────────────────────────────────────────────
    # The same phrase-level captions in every language: whole sentences
    # again after translation, cut at punctuation and natural word groups,
    # timed to the speech's word timestamps, 0.8-7 s each, no flicker gaps
    # and no caption across a pause (services/phrasing.py).
    segments = [
        transcription.Segment(
            start_ms=phrase.start_ms, end_ms=phrase.end_ms, text=phrase.text,
            confidence=phrase.confidence,
        )
        for phrase in phrasing.rephrase(segments)
    ]

    # ── 4. Persist captions ─────────────────────────────────────────────
    async with worker_session() as session:
        session.add_all(
            [
                Caption(
                    video_id=video_id,
                    sequence=index,
                    start_ms=segment.start_ms,
                    end_ms=segment.end_ms,
                    text=caption_service.restore_breaks(segment.text, breaks),
                    confidence=segment.confidence,
                )
                for index, segment in enumerate(segments)
            ]
        )
        await session.commit()

        caption_ids = list(
            (
                await session.execute(
                    select(Caption.id)
                    .where(Caption.video_id == video_id)
                    .order_by(Caption.sequence)
                )
            ).scalars()
        )

    # ── 5. Embed and index ──────────────────────────────────────────────
    await _set_progress(video_id, STAGE_EMBEDDING, 0)
    try:
        await asyncio.to_thread(embeddings.index_captions, video_id, caption_ids, segments)
    except Exception as exc:  # noqa: BLE001
        # Captions are already saved and useful on their own. A vector store
        # problem degrades search, so it shouldn't fail the whole transcription.
        logger.error("Indexing failed for video %s: %s", video_id, exc)

    # ── Done ────────────────────────────────────────────────────────────
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is not None:
            video.status = VideoStatus.COMPLETED
            video.stage = None
            video.stage_detail = None
            video.progress = 100
            video.error_message = None
            video.notice = " ".join(notices)[:300] or None
            video.speech = spoken
            if detected_now or video.detected_language is None:
                # What was heard, so the editor's Redo knows to offer the
                # Hindi script choice.
                video.detected_language = hint
                video.detected_confidence = round(float(confidence), 3)
            if chosen_script == languages.SCRIPT_AUTO and script is not None:
                # Decided now; a Redo repeats it rather than deciding again.
                video.hindi_script = script
            await session.commit()

    return {"video_id": video_id, "segments": len(segments), "language": language}


async def _reindex(video_id: int) -> dict:
    """
    Rebuild the vector index for one video from its current captions.

    Re-embedding the whole video rather than the individual edited captions:
    it keeps deletes, splits and merges correct without tracking which vector
    ids went away, and the embedding model is already warm in this process so
    a few hundred short strings cost little.
    """
    async with worker_session() as session:
        captions = list(
            (
                await session.execute(
                    select(Caption)
                    .where(Caption.video_id == video_id)
                    .order_by(Caption.sequence)
                )
            ).scalars()
        )

    # Always clear first: a caption deleted since the last index would
    # otherwise keep its vector and go on matching searches.
    embeddings.delete_video_vectors(video_id)

    if not captions:
        return {"video_id": video_id, "indexed": 0}

    segments = [
        transcription.Segment(
            start_ms=c.start_ms, end_ms=c.end_ms, text=c.text, confidence=c.confidence
        )
        for c in captions
    ]
    await asyncio.to_thread(
        embeddings.index_captions, video_id, [c.id for c in captions], segments
    )

    return {"video_id": video_id, "indexed": len(captions)}


@celery_app.task(name="reindex_captions")
def reindex_captions(video_id: int, caption_ids: list[int] | None = None) -> dict:
    """
    Re-embed a video's captions after an edit.

    caption_ids is accepted for logging and future partial updates; the work
    itself is whole-video for the reasons in _reindex.
    """
    try:
        return asyncio.run(_reindex(video_id))
    except Exception as exc:  # noqa: BLE001
        # Stale search results are a degradation, not a reason to surface an
        # error against an edit the user already saw succeed.
        logger.error("Reindex failed for video %s: %s", video_id, exc)
        return {"video_id": video_id, "error": str(exc)}


async def _detect(video_id: int) -> dict:
    """
    Hear the first 30 s of a held upload, for the language step (v1.0.9).

    The same model and window the job itself detects with, so what the step
    shows is what the job would decide.
    """
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is None:
            return {"video_id": video_id, "skipped": "video deleted"}
        source_relative = video.storage_path
        whisper_choice = await app_settings.whisper_override(session)

    source = storage.resolve(source_relative)
    clip = source.with_suffix(".detect.wav")
    try:
        profile = hardware.whisper_profile(hardware.detect(), whisper_choice)
        await asyncio.to_thread(transcription.load_model, profile)
        await asyncio.to_thread(
            transcription.extract_audio, source, clip, transcription.DETECTION_SECONDS
        )
        language, confidence = await asyncio.to_thread(transcription.detect_language, clip)
    finally:
        clip.unlink(missing_ok=True)
    logger.info("Video %s: language step heard %s (%.2f)", video_id, language, confidence)

    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is not None:
            video.detected_language = language
            video.detected_confidence = round(float(confidence), 3)
            if video.held:
                video.stage = None
            await session.commit()
    return {"video_id": video_id, "language": language, "confidence": confidence}


@celery_app.task(name="detect_spoken_language")
def detect_spoken_language(video_id: int) -> dict:
    try:
        return asyncio.run(_detect(video_id))
    except Exception as exc:  # noqa: BLE001
        # The language step then asks without a preset, as it does when
        # detection is slow; nothing is lost but a default.
        logger.error("Language detection failed for video %s: %s", video_id, exc)
        asyncio.run(_detection_failed(video_id))
        return {"video_id": video_id, "error": str(exc)[:200]}


async def _detection_failed(video_id: int) -> None:
    """Stop the language step showing "listening" for a detection that won't come."""
    async with worker_session() as session:
        video = await session.get(Video, video_id)
        if video is not None and video.stage == "detecting":
            video.stage = None
            await session.commit()


@celery_app.task(name="transcribe_video", bind=True)
def transcribe_video(self, video_id: int, keep_breaks: bool = False) -> dict:
    try:
        return asyncio.run(_run(video_id, keep_breaks))
    except Exception as exc:
        logger.exception("Transcription failed for video %s", video_id)
        # A video stuck on "processing" forever is worse than an honest
        # failure the user can see and retry.
        asyncio.run(_mark_failed(video_id, friendly_error(exc)))
        raise
