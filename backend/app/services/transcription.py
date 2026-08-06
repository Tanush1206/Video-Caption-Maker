"""
Speech-to-text with faster-whisper.

The model is loaded once per worker process and cached. Loading `medium` onto
the GPU takes ~10s and several GB of VRAM; doing that per video would dominate
the runtime and risk exhausting memory.

This module is imported by the Celery worker, not the API. Keeping the import
out of the API process is why the API starts instantly.
"""

import logging
import subprocess
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_model = None


@dataclass
class Segment:
    """One transcribed span. Times are milliseconds; Whisper emits seconds."""

    start_ms: int
    end_ms: int
    text: str
    confidence: float | None


def get_model():
    """Lazily load and cache the Whisper model for this process."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        logger.info(
            "Loading Whisper '%s' on %s (%s)",
            settings.whisper_model_size,
            settings.whisper_device,
            settings.whisper_compute_type,
        )
        _model = WhisperModel(
            settings.whisper_model_size,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
        )
    return _model


def extract_audio(source: Path, destination: Path) -> None:
    """
    Pull a 16kHz mono WAV out of the video.

    Whisper resamples to 16kHz mono internally, so doing it once up front is
    both faster and smaller than handing it the original file. Raises on
    failure — unlike thumbnails, there is no useful result without audio.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(source),
            "-vn",              # drop the video stream
            "-acodec", "pcm_s16le",
            "-ar", "16000",     # 16kHz, what Whisper expects
            "-ac", "1",         # mono
            str(destination),
        ],
        capture_output=True,
        timeout=60 * 20,
    )

    if result.returncode != 0 or not destination.exists():
        tail = result.stderr.decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"Audio extraction failed: {tail}")


def transcribe(
    audio_path: Path,
    *,
    on_progress: Callable[[int], None] | None = None,
) -> tuple[list[Segment], str]:
    """
    Transcribe an audio file, returning (segments, detected_language).

    faster-whisper yields segments lazily as it decodes, so progress is
    reported from how far through the audio each segment ends — the only
    progress signal available without patching the library.
    """
    model = get_model()

    raw_segments, info = model.transcribe(
        str(audio_path),
        vad_filter=settings.whisper_vad_filter,
        language=settings.whisper_language,
        beam_size=5,
    )

    total_seconds = info.duration or 0
    segments: list[Segment] = []

    for index, segment in enumerate(_iter(raw_segments)):
        text = segment.text.strip()
        if text:
            segments.append(
                Segment(
                    start_ms=int(segment.start * 1000),
                    end_ms=int(segment.end * 1000),
                    text=text,
                    confidence=getattr(segment, "avg_logprob", None),
                )
            )

        if on_progress and total_seconds > 0 and index % 5 == 0:
            percent = min(int(segment.end / total_seconds * 100), 99)
            on_progress(percent)

    return segments, info.language or "unknown"


def _iter(segments) -> Iterator:
    """Consuming the generator is what actually performs the decoding."""
    yield from segments
