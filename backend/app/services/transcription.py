"""
Speech-to-text with faster-whisper.

The model is loaded once per worker process and cached. Loading `medium` onto
the GPU takes ~10s and several GB of VRAM; doing that per video would dominate
the runtime and risk exhausting memory.

This module is imported by the Celery worker, not the API. Keeping the import
out of the API process is why the API starts instantly.
"""

import gc
import logging
import subprocess
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

from app.config import get_settings
from app.services import model_store

logger = logging.getLogger(__name__)
settings = get_settings()

PROBE_TIMEOUT_SECONDS = 30

# The files faster-whisper itself fetches for a CTranslate2 Whisper model.
WHISPER_FILES = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]

_model = None
_model_key: tuple[str, str, str] | None = None
# Set when the GPU was asked for and could not be used, so the job can say
# why it ran slowly instead of leaving the user to guess.
fallback_note: str | None = None
# Set by transcribe() when nothing cleared Whisper's no-speech check and the
# captions came from a second, less strict pass.
low_confidence_note: str | None = None

LOW_CONFIDENCE_NOTE = (
    "The speech model was unsure of this audio, so the captions may have errors. "
    "A larger speech model in Settings is more accurate."
)


@dataclass
class Segment:
    """One transcribed span. Times are milliseconds; Whisper emits seconds."""

    start_ms: int
    end_ms: int
    text: str
    confidence: float | None


def _repo_for(model: str) -> str:
    if "/" in model:
        return model
    from faster_whisper.utils import _MODELS

    repo = _MODELS.get(model)
    if repo is None:
        raise ValueError(f"Unknown Whisper model {model!r}")
    return repo


def load_model(profile, on_download: model_store.Progress | None = None):
    """
    Load the Whisper model a profile names, reusing the cached one if it matches.

    Unloads the translator first: the two are never resident together, so a
    machine sized for one of them at a time can run both stages.
    """
    global _model, _model_key, fallback_note

    key = (profile.model, profile.device, profile.compute_type)
    if _model is not None and _model_key == key:
        return _model

    unload_model()
    from app.services import translation

    translation.unload()

    from faster_whisper import WhisperModel

    path = model_store.ensure(
        _repo_for(profile.model), allow_patterns=WHISPER_FILES, on_progress=on_download
    )
    logger.info(
        "Loading Whisper '%s' on %s (%s)", profile.model, profile.device, profile.compute_type
    )
    fallback_note = None
    try:
        _model = WhisperModel(path, device=profile.device, compute_type=profile.compute_type)
    except (RuntimeError, ValueError) as exc:
        if profile.device != "cuda":
            raise
        # A driver too old for the image's CUDA, a card CTranslate2 has no
        # kernels for, or VRAM taken by something else: all of them leave the
        # CPU perfectly able to do the job, just slower.
        logger.warning("Whisper could not use the GPU (%s); falling back to CPU", exc)
        fallback_note = "The GPU couldn't be used, so this ran on the CPU."
        _model = WhisperModel(path, device="cpu", compute_type="int8")
        key = (profile.model, "cpu", "int8")
    _model_key = key
    return _model


def get_model():
    """The loaded Whisper model, loading the hardware default if none is."""
    if _model is None:
        from app.services import hardware

        load_model(hardware.whisper_profile(hardware.detect()))
    return _model


def unload_model() -> None:
    """Drop the model so its RAM/VRAM is free for the next stage."""
    global _model, _model_key
    if _model is None:
        return
    _model = None
    _model_key = None
    gc.collect()
    logger.info("Unloaded Whisper")


def has_audio_stream(path: Path) -> bool:
    """
    Whether the file contains at least one audio stream.

    Two things here are not the obvious version, and both were producing "this
    video has no audio track" for videos that plainly had one.

    The probe window is raised well above FFmpeg's default. ffprobe decides
    what streams exist after reading a few seconds and a few megabytes, and a
    long download whose audio packets do not appear early — a silent intro, an
    unusual interleave, a stream ordered after a large video keyframe — reports
    no audio at all. 200MB / 200s costs nothing on a local file and removes the
    entire class of false negatives.

    And a *failed* probe is no longer read as "no audio". Returning False on a
    non-zero exit conflated "ffprobe could not parse this" with "there is
    nothing to transcribe", so a container FFmpeg disliked was reported to the
    user as a fact about their audio. Now the error propagates and says what
    actually happened.
    """
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            # Before -i, so they apply to opening the input.
            "-analyzeduration", "200M",
            "-probesize", "200M",
            "-select_streams", "a",
            "-show_entries", "stream=index",
            "-of", "csv=p=0",
            str(path),
        ],
        capture_output=True,
        timeout=PROBE_TIMEOUT_SECONDS,
    )

    if result.returncode != 0:
        tail = result.stderr.decode("utf-8", "replace").strip()[-300:]
        raise RuntimeError(f"Could not read this video's streams: {tail}")

    return bool(result.stdout.strip())


# What counts as silence when deciding a caption was invented: quieter than
# this, for at least this long. -40dB is well below any speech or music that is
# actually playing, and 1.5s is longer than a pause between words.
SILENCE_NOISE_DB = -40
SILENCE_MIN_SECONDS = 1.5

# How much of a segment must sit inside silence before it is dropped. Not 100%:
# a hallucination that begins in silence and runs a moment past the point where
# real audio starts is still a hallucination, and a genuine line that starts
# just before the audio does is not something Whisper produces.
SILENT_OVERLAP_TO_DROP = 0.9


def silent_spans(audio_path: Path) -> list[tuple[float, float]]:
    """
    Where the audio is actually silent, in seconds.

    Read from FFmpeg's `silencedetect`, which measures the waveform rather than
    guessing at it. This is the check that makes running Whisper *without* VAD
    safe: VAD decides "is this speech?" and gets sung vocals wrong, while this
    only asks "is there any sound here at all?", which has an unambiguous
    answer.

    Returns an empty list if the probe fails. Failing open is right — the worst
    case is that a hallucinated caption survives, which is where we started.
    """
    result = subprocess.run(
        [
            "ffmpeg", "-i", str(audio_path),
            "-af", f"silencedetect=n={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SECONDS}",
            "-f", "null", "-",
        ],
        capture_output=True,
        timeout=60 * 10,
    )

    spans: list[tuple[float, float]] = []
    start: float | None = None
    for line in result.stderr.decode("utf-8", "replace").splitlines():
        if "silence_start:" in line:
            try:
                start = float(line.split("silence_start:")[1].split()[0])
            except (IndexError, ValueError):
                start = None
        elif "silence_end:" in line and start is not None:
            try:
                spans.append((start, float(line.split("silence_end:")[1].split()[0])))
            except (IndexError, ValueError):
                pass
            start = None

    # A file that ends silent never reports an end.
    if start is not None:
        spans.append((start, float("inf")))

    return spans


def _clamp_to_audible(start: float, end: float, spans: list[tuple[float, float]]) -> float:
    """
    Pull a segment's start forward to where sound actually begins.

    Whisper places a segment boundary where it thinks a phrase began, and over
    a long silent intro it reaches backwards — on a file with 116 seconds of
    digital silence it started the first real line at 109.4s. The words are
    right, the timing is not, and the visible result is a caption sitting on
    screen over a silent stretch of video.

    Nothing can have been said before there was any sound, so a start inside a
    silent span moves to the end of that span. Only the start: a segment that
    runs *into* trailing silence is just a caption held a little long, which is
    harmless and often deliberate.
    """
    for silent_start, silent_end in spans:
        if silent_start <= start < silent_end < end:
            return silent_end
    return start


def _spoken_bounds(segment) -> tuple[float, float]:
    """
    When the words in a segment were actually said.

    Whisper's segment boundaries mark where it decided a *phrase* belongs,
    which over an instrumental intro reaches back to the start of the decode
    window. Measured on a song whose first line is sung at 17.3s, the segment
    claimed 0.0s — so the caption sat on screen through seventeen seconds of
    music before anyone sang. The same boundary runs long at the other end: one
    segment ended at 131.0s for singing that stopped at 119.7s.

    Word timestamps come from aligning the decoded tokens against the model's
    cross-attention, so they describe when the sound happened rather than which
    window it was decoded in. On that file every segment tightened, several by
    more than ten seconds.

    Falls back to the segment's own bounds when alignment produced no usable
    words, and never widens them: alignment can place a word fractionally
    outside the window it came from, and trusting that over the decoder would
    be reintroducing the same error from the other direction.
    """
    words = getattr(segment, "words", None) or []
    starts = [word.start for word in words if word.start is not None]
    ends = [word.end for word in words if word.end is not None]
    if not starts or not ends:
        return segment.start, segment.end

    start = max(min(starts), segment.start)
    end = min(max(ends), segment.end)
    # A collapsed or inverted range means the alignment disagreed with the
    # decoder about this segment entirely; the decoder is the safer answer.
    return (start, end) if end > start else (segment.start, segment.end)


# Refining a caption's start against the waveform.
#
# Word timestamps put the words in roughly the right place; these put them on
# the beat. Measured on a song whose first line Whisper timed at 17.34s, the
# vocal actually enters at 18.50s with a +12.7 dB step, and 17.34 sits in the
# quiet instrumental tail before it.
#
# The band matters. Full-band energy is dominated by drums and bass, which are
# playing throughout and drown the moment a voice arrives; 300-3400 Hz is where
# speech and sung vowels live and where their entry is visible as a step.
ONSET_BAND_LOW_HZ = 300
ONSET_BAND_HIGH_HZ = 3400
ONSET_WINDOW_SECONDS = 0.25

# Two questions, asked in order, because they fail in opposite places.
#
#   1. "Does this caption start in a hole quieter than its own speech?"
#   2. "Is there a step up just after where it starts?"
#
# The first reaches far and fires rarely; the second reaches close and fires
# constantly. Measured over 603 captions in three videos:
#
#                            song (23)    talk (228)         lecture (352)
#   level, within 9dB/2.0s   1, 1.16s     29, 0.21s (0.93)   52, 0.20s (0.79)
#   jump, 6dB within 1.0s    3, 0.00s    139, 0.35s (0.93)  336, 0.20s (0.84)
#
# The lecture row for the jump rule is the systematic one: 336 of 352 captions
# nudged by a mean of 0.20s. That is Whisper's word timestamps running
# consistently a fifth of a second early on ordinary speech, and the step
# detector corrects it everywhere.
#
# The song row is why the level rule exists at all. Its first caption starts at
# 17.34s over an instrumental holding at -24 dB; the singing enters at 18.50 at
# -12. That is 1.16s away — out of the step detector's reach, and deliberately
# so: widening the step detector to 2.0s costs 23 captions in the talk moving
# by over a second, past the words they were timing. The level rule crosses the
# same 1.16s and moves nothing anywhere by more than 0.93s, because it is
# bounded by something real rather than by a time limit. It only fires when the
# audio at the start is far below what the caption itself sounds like.
ONSET_LOOKBACK_SECONDS = 0.25
ONSET_LOOKAHEAD_SECONDS = 1.0

# What counts as "something started". Below this the rule fires on the ordinary
# rise and fall of a held note.
ONSET_MIN_JUMP_DB = 6.0

# The caption's own speaking level, and how far under it still counts as having
# started. Taken at the 60th percentile of the caption's windows rather than
# the median or the peak: high enough to mean "this is the voice", low enough
# to survive the pauses between words that any real line contains.
ONSET_SPEECH_PERCENTILE = 0.6
ONSET_LEVEL_TOLERANCE_DB = 9.0
ONSET_LEVEL_REACH_SECONDS = 2.0

# Quieter than any real signal; what an all-zero window reports as -inf.
SILENT_DB = -120.0


def vocal_envelope(audio_path: Path) -> list[float]:
    """
    The loudness of the speech band, once per window, for the whole file.

    One FFmpeg pass building a list whose index is the window number, so a time
    lookup later is arithmetic rather than a search. Returns an empty list if
    the probe fails, which turns the refinement below into a no-op — the same
    failing-open that `silent_spans` does, and for the same reason.
    """
    samples = int(16000 * ONSET_WINDOW_SECONDS)
    chain = (
        f"highpass=f={ONSET_BAND_LOW_HZ},lowpass=f={ONSET_BAND_HIGH_HZ},"
        # Fixed-size frames, so every reported window covers the same duration
        # and the index really is the time. astats alone would follow whatever
        # frame size the decoder happened to produce.
        f"asetnsamples=n={samples},"
        "astats=metadata=1:reset=1,"
        # astats only *stores* the measurement; ametadata is what prints it.
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-"
    )

    try:
        result = subprocess.run(
            ["ffmpeg", "-i", str(audio_path), "-af", chain, "-f", "null", "-"],
            capture_output=True,
            timeout=60 * 10,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("Could not measure the vocal envelope: %s", exc)
        return []

    levels: list[float] = []
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        if "RMS_level=" not in line:
            continue
        value = line.split("RMS_level=")[1].strip()
        try:
            levels.append(float(value))
        except ValueError:
            # "-inf" for a window of pure digital silence.
            levels.append(SILENT_DB)

    return levels


def _window(seconds: float) -> int:
    return int(seconds / ONSET_WINDOW_SECONDS)


def _reaches_speaking_level(
    start: float, end: float, levels: list[float], floor: float
) -> float | None:
    """
    Move the start forward to where the audio reaches the caption's own level.

    The reference is taken from the caption itself, which is what lets this
    reach twice as far as the step detector without ever running away: there is
    no arbitrary distance limit doing the work, only "the audio here is nothing
    like what this line sounds like". A caption that already starts at speaking
    level returns None and falls through to the finer correction.
    """
    first, last = _window(start), min(len(levels) - 1, _window(end))
    if last <= first:
        return None

    body = sorted(levels[first : last + 1])
    speaking = body[min(int(len(body) * ONSET_SPEECH_PERCENTILE), len(body) - 1)]
    limit = min(last, _window(start + ONSET_LEVEL_REACH_SECONDS))

    for index in range(first, limit + 1):
        if levels[index] < speaking - ONSET_LEVEL_TOLERANCE_DB:
            continue
        # Already there — nothing to correct, and no claim to make.
        return None if index == first else max(index * ONSET_WINDOW_SECONDS, floor)

    return None


def _steps_up(start: float, end: float, levels: list[float], floor: float) -> float | None:
    """
    Move the start to the first clear step up near it.

    The **first** qualifying step, not the biggest: the question is when the
    line started, and the loudest moment of a sung phrase is usually somewhere
    in its middle. Taking the biggest moved 47 captions by over a second where
    taking the first moved 7.
    """
    first = max(1, _window(start - ONSET_LOOKBACK_SECONDS))
    last = min(len(levels) - 1, _window(min(start + ONSET_LOOKAHEAD_SECONDS, end)))

    for index in range(first, last + 1):
        if levels[index] - levels[index - 1] < ONSET_MIN_JUMP_DB:
            continue
        return max(index * ONSET_WINDOW_SECONDS, floor)

    return None


def _snap_to_onset(start: float, end: float, levels: list[float], floor: float) -> float:
    """
    Move a caption's start to the moment the sound actually arrives.

    `floor` is the previous caption's end: a small backwards nudge is allowed,
    but not one that overlaps the line before.
    """
    if not levels:
        return start

    # Level first. When it fires it has found the real entry, and running the
    # step detector afterwards could only push the start further into the line.
    return (
        _reaches_speaking_level(start, end, levels, floor)
        or _steps_up(start, end, levels, floor)
        or start
    )


def _silent_fraction(start: float, end: float, spans: list[tuple[float, float]]) -> float:
    """How much of a segment lies inside silence, 0..1."""
    span_length = end - start
    if span_length <= 0:
        return 0.0

    covered = sum(
        max(0.0, min(end, silent_end) - max(start, silent_start))
        for silent_start, silent_end in spans
    )
    return covered / span_length


def vad_parameters() -> dict:
    """
    Silero VAD's settings, and why they are not the defaults.

    The default threshold of 0.5 asks "is this confidently speech?", which is
    the right question for a phone recording and the wrong one for anything
    with music under the voice. Measured on a five-minute music video, over a
    120-second span with a mean level of -10.8 dB — loud, continuous, obviously
    audible material:

        threshold 0.5 (default)   1 segment    7.8s of 120 kept
        threshold 0.35            2 segments  44.8s
        threshold 0.2             4 segments  47.5s
        threshold 0.1 + padding   6 segments  67.4s
        VAD disabled entirely    10 segments  86.0s

    That is the bug where a video "only transcribes the first line": VAD threw
    away 93% of the audio before Whisper ever saw it, and the model dutifully
    transcribed what was left.

    Disabling VAD recovers the most audio and is still wrong. Over 116 seconds
    of *digital silence* it invents seven captions and drags the first real one
    from 116s to 90s — captions appearing on screen where there is nothing to
    hear. Keeping VAD permissive gets 8.6x the speech of the default with zero
    hallucinated segments, which is the trade worth making.
    """
    return {
        "threshold": settings.whisper_vad_threshold,
        # Padding around each detected chunk, so a quiet first syllable is not
        # clipped off the front of a phrase.
        "speech_pad_ms": settings.whisper_vad_speech_pad_ms,
        # How much quiet ends a chunk. Longer than the default, so a breath
        # between lines does not split one sentence into two captions.
        "min_silence_duration_ms": settings.whisper_vad_min_silence_ms,
    }


def extract_audio(source: Path, destination: Path) -> None:
    """
    Pull a 16kHz mono WAV out of the video.

    Whisper resamples to 16kHz mono internally, so doing it once up front is
    both faster and smaller than handing it the original file. Raises on
    failure — unlike thumbnails, there is no useful result without audio.
    """
    # Checked explicitly so a silent video produces a message the user can act
    # on. Without this, FFmpeg fails with "Output file does not contain any
    # stream", which reads like a bug in the app rather than a fact about
    # their file.
    if not has_audio_stream(source):
        raise RuntimeError("This video has no audio track, so there is nothing to transcribe")

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


# Whisper looks at one 30-second window to decide what language it is hearing,
# and sampling more of the file makes it *worse*, not better: on a sung Hindi
# track, one window says Hindi, five say Sanskrit at 0.65 confidence. Music
# under a voice drifts the estimate somewhere liturgical.
DETECTION_SECONDS = 30


def detect_language(audio_path: Path) -> tuple[str, float]:
    """
    What language this is, before committing to transcribing it as that.

    Split out from `transcribe`, which does the same detection internally,
    because the answer needs inspecting first — see
    `languages.TRANSCRIPTION_SUBSTITUTES` for the case where the detected
    language is correct and still the wrong one to transcribe as.

    One encoder pass over thirty seconds; cheap next to transcription.
    """
    from faster_whisper.audio import decode_audio

    audio = decode_audio(str(audio_path))
    # Only the first window is ever used. Feature-extracting an hour of audio
    # to look at thirty seconds of it is pure waste.
    language, probability, _ = get_model().detect_language(
        audio=audio[: 16000 * DETECTION_SECONDS]
    )
    return language, probability


def transcribe(
    audio_path: Path,
    *,
    language: str | None = None,
    task: str = "transcribe",
    on_progress: Callable[[int], None] | None = None,
) -> tuple[list[Segment], str]:
    """
    Transcribe an audio file, returning (segments, detected_language).

    faster-whisper yields segments lazily as it decodes, so progress is
    reported from how far through the audio each segment ends — the only
    progress signal available without patching the library.
    """
    global low_confidence_note
    low_confidence_note = None
    model = get_model()

    # Measured once, up front, rather than per segment: one pass over the file
    # against thousands of interval comparisons.
    spans = silent_spans(audio_path) if not settings.whisper_vad_filter else []
    # The second measurement of the same audio, asking a different question:
    # `spans` is "is there any sound at all", this is "when does the voice
    # arrive". Silence detection cannot see a singer entering over an
    # instrumental, because the instrumental is not silent.
    levels = vocal_envelope(audio_path)

    segments, info = _decode(model, audio_path, language, task, spans, levels, on_progress)
    if not segments:
        # Whisper skips a 30-second window when it thinks it is probably not
        # speech AND its words are unlikely. A small model on fast speech in
        # a language it knows less well can do that to every window: Whisper
        # small on a 60-second Hindi tutorial scored no_speech 0.61-0.67 at
        # logprob below -1.0 throughout, and returned nothing at all. Without
        # the no-speech check it returns real, if rough, captions. Hallucination
        # over genuine silence is still caught by the silent-span check.
        logger.info("No segments passed the no-speech check; retrying without it")
        segments, info = _decode(
            model, audio_path, language, task, spans, levels, on_progress,
            no_speech_threshold=None,
        )
        if segments:
            low_confidence_note = LOW_CONFIDENCE_NOTE

    return segments, info.language or "unknown"


def _decode(model, audio_path, language, task, spans, levels, on_progress, **options):
    """One Whisper pass, filtered and retimed into caption segments."""
    raw_segments, info = model.transcribe(
        str(audio_path),
        vad_filter=settings.whisper_vad_filter,
        vad_parameters=vad_parameters(),
        # An explicit language beats the configured default, which beats
        # Whisper's own detection. Detection is the weakest of the three by a
        # wide margin on anything sung — on a Punjabi song it covered 42 of 90
        # seconds at an average logprob of -1.77, against 81s at -0.71 when
        # told what it was listening to.
        language=language or settings.whisper_language,
        # "translate" means "into English" and nothing else — Whisper has no
        # target parameter. Every other language is handled after the fact by
        # services/translation.py.
        task=task,
        beam_size=5,
        # Per-word timings, which is what makes a caption appear when the words
        # are said rather than when Whisper's decode window opened. See
        # _spoken_bounds for the measurements; it costs an alignment pass.
        word_timestamps=True,
        **options,
    )

    total_seconds = info.duration or 0
    segments: list[Segment] = []
    dropped = 0

    for index, segment in enumerate(_iter(raw_segments)):
        text = segment.text.strip()
        if text:
            # Tighten to the words before anything else looks at the timings:
            # the silence checks below are only as good as the bounds they are
            # handed, and Whisper's own can be tens of seconds wide of the
            # speech they describe.
            start, end = _spoken_bounds(segment)

            # Whisper invents text over silence — reliably enough that VAD was
            # switched on to prevent it, at the cost of most of the audio in
            # anything musical. Checking the waveform afterwards catches the
            # same hallucinations without throwing away real singing first.
            if spans and _silent_fraction(start, end, spans) >= SILENT_OVERLAP_TO_DROP:
                dropped += 1
            else:
                start = _clamp_to_audible(start, end, spans)
                # Last, and against the waveform rather than the model: the
                # words are in the right place by now, this puts them on the
                # moment they are heard. Never earlier than the caption before.
                start = _snap_to_onset(
                    start, end, levels, segments[-1].end_ms / 1000 if segments else 0.0
                )
                segments.append(
                    Segment(
                        start_ms=int(start * 1000),
                        end_ms=int(end * 1000),
                        text=text,
                        confidence=getattr(segment, "avg_logprob", None),
                    )
                )

        if on_progress and total_seconds > 0 and index % 5 == 0:
            percent = min(int(segment.end / total_seconds * 100), 99)
            on_progress(percent)

    if dropped:
        logger.info("Dropped %d segment(s) that fell in silence", dropped)

    return segments, info


def _iter(segments) -> Iterator:
    """Consuming the generator is what actually performs the decoding."""
    for segment in segments:
        yield from _split_long(segment)


# A caption a viewer can read: two lines of ~42 characters, on screen for no
# more than a few seconds. large-v3 decodes in phrases of up to ~200 characters
# — measured on a 60-second Hindi clip, six segments for the whole minute — and
# burned in, one of those wraps to five lines across the middle of the frame.
MAX_CAPTION_CHARS = 84
MAX_CAPTION_SECONDS = 6.0
# Where a sentence or clause ends, a break reads naturally. `।` is the
# Devanagari full stop.
CLAUSE_END = (".", ",", "!", "?", ";", ":", "।", "、", "。", "，")


def _split_long(segment) -> Iterator:
    """
    Cut a long Whisper segment into caption-sized pieces at word boundaries.

    Uses the per-word timings, so each piece starts and ends when its own
    words are said rather than sharing the segment's span. Prefers to break
    after a clause once a piece is reasonably full, so a line ends where a
    reader would pause. Segments without word timings pass through whole:
    there is no honest way to time a piece of them.
    """
    words = [w for w in (getattr(segment, "words", None) or []) if w.start is not None]
    text = segment.text.strip()
    duration = (segment.end or 0) - (segment.start or 0)
    if not words or (len(text) <= MAX_CAPTION_CHARS and duration <= MAX_CAPTION_SECONDS):
        yield segment
        return

    def piece(chunk):
        return SimpleNamespace(
            text="".join(w.word for w in chunk).strip(),
            start=max(chunk[0].start, segment.start),
            end=min(chunk[-1].end, segment.end),
            words=chunk,
            avg_logprob=getattr(segment, "avg_logprob", None),
        )

    chunk: list = []
    for word in words:
        if chunk:
            length = len("".join(w.word for w in chunk + [word]).strip())
            span = word.end - chunk[0].start
            if length > MAX_CAPTION_CHARS or span > MAX_CAPTION_SECONDS:
                yield piece(chunk)
                chunk = []
        chunk.append(word)
        filled = len("".join(w.word for w in chunk).strip())
        if filled >= MAX_CAPTION_CHARS * 0.5 and word.word.strip().endswith(CLAUSE_END):
            yield piece(chunk)
            chunk = []
    if chunk:
        yield piece(chunk)
