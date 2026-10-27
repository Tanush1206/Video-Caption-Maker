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
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace

from app.config import get_settings
from app.services import media, model_store

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

# The Hinglish speech model's name in a WhisperProfile (services/hinglish.py).
HINGLISH = "hinglish"

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

# A job that finds nothing to caption (v1.0.11): nothing heard, or all of it
# over silence. It finishes, and says so, rather than leaving an empty list.
NO_SPEECH_NOTICE = "No speech was found in this video."


@dataclass
class Segment:
    """One transcribed span. Times are milliseconds; Whisper emits seconds."""

    start_ms: int
    end_ms: int
    text: str
    confidence: float | None
    # When each word was said, (start_ms, end_ms, word), from Whisper's word
    # timestamps: what captions are timed to (services/phrasing.py). Kept
    # through translation, where the words no longer match the text but the
    # speech is still the speech.
    speech: list[tuple[int, int, str]] = field(default_factory=list)


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

    if profile.model == HINGLISH:
        from app.services import hinglish

        path = hinglish.apex_dir(on_download)
    else:
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


def main_streams(path: Path) -> media.Streams:
    """
    The file's main picture and sound (`media.inspect`), or an error.

    A *failed* probe is never read as "no audio". Returning False on a non-zero
    exit once conflated "ffprobe could not parse this" with "there is nothing
    to transcribe", so a container FFmpeg disliked was reported to the user as
    a fact about their audio.

    The streams come from the container's headers, which list every track up
    front, so a long download whose audio packets start late is still seen to
    have audio (the reason this once raised ffprobe's probe window to 200 MB).
    """
    streams = media.inspect(path)
    if streams is None:
        raise RuntimeError("Could not read this video's streams")
    return streams


def has_audio_stream(path: Path) -> bool:
    """Whether the file has a main sound stream in a codec we decode."""
    streams = main_streams(path)
    if streams.audio is None and streams.unsupported_audio:
        raise RuntimeError(f"Unsupported audio format: {streams.unsupported_audio}")
    return streams.audio is not None


# What counts as silence when deciding a caption was invented: quieter than
# this, for at least this long. -40dB is well below any speech or music that is
# actually playing, and 1.5s is longer than a pause between words.
SILENCE_NOISE_DB = -40
SILENCE_MIN_SECONDS = 1.5

# ...unless that would make the speech itself silence (v1.0.11). A distant or
# quiet microphone speaks below -40dB throughout: 27 of 50 English FLEURS
# clips peak at -44 to -54dB, and all 27 came out with no captions, every
# word dropped as invented over silence. In each of them all the voiced
# windows (the speech band within VOICED_DB of the speaking level) sat inside
# a -40dB silence; in every clip that worked, at most 35%, and 0% on the
# Hinglish tutorial. Over SPEECH_IN_SILENCE of them, the threshold follows
# the speaking level down instead, SILENCE_UNDER_SPEAKING_DB under it, never
# under SILENCE_FLOOR_DB, so a silent or dithered track is still silence.
# Only then: lowered for every moderately quiet clip, it let the faint noise
# around German and Russian clips (-42 to -45dB, their speech peaking at
# -20) stop being silence, and "Vielen Dank." invented over it survived.
SPEECH_IN_SILENCE = 0.5
SILENCE_UNDER_SPEAKING_DB = 15
SILENCE_FLOOR_DB = -80


def silence_for(audio_path: Path, levels: list[float]) -> list[tuple[float, float]]:
    """The silent spans to drop invented text over: at -40dB, or lower when that would swallow the speech."""
    spans = silent_spans(audio_path)
    if not spans or _speech_in_silence(levels, spans) <= SPEECH_IN_SILENCE:
        return spans
    noise_db = silence_threshold(levels)
    if noise_db >= SILENCE_NOISE_DB:
        return spans
    logger.info("A quiet recording: silence is under %.1f dB rather than %d dB", noise_db, SILENCE_NOISE_DB)
    return silent_spans(audio_path, noise_db)


def _speech_in_silence(levels: list[float], spans: list[tuple[float, float]]) -> float:
    """The share of the voiced envelope windows whose middle lies inside `spans`."""
    if not levels:
        return 0.0
    speaking = _speaking_level(levels)
    voiced = [i for i, level in enumerate(levels) if level >= speaking - VOICED_DB]
    if not voiced:
        return 0.0
    inside = sum(
        1 for i in voiced
        if any(start <= (i + 0.5) * ONSET_WINDOW_SECONDS < end for start, end in spans)
    )
    return inside / len(voiced)


def silence_threshold(levels: list[float]) -> float:
    """The level under which audio counts as silent, in dB, for a file with these speech-band `levels`."""
    if not levels:
        return SILENCE_NOISE_DB
    under_speech = _speaking_level(levels) - SILENCE_UNDER_SPEAKING_DB
    return max(SILENCE_FLOOR_DB, min(SILENCE_NOISE_DB, under_speech))

# How much of a segment must sit inside silence before it is dropped. Not 100%:
# a hallucination that begins in silence and runs a moment past the point where
# real audio starts is still a hallucination, and a genuine line that starts
# just before the audio does is not something Whisper produces.
SILENT_OVERLAP_TO_DROP = 0.9


def silent_spans(audio_path: Path, noise_db: float = SILENCE_NOISE_DB) -> list[tuple[float, float]]:
    """
    Where the audio is actually silent (under `noise_db`), in seconds.

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
            "-af", f"silencedetect=n={noise_db:.1f}dB:d={SILENCE_MIN_SECONDS}",
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


def vocal_envelope(audio_path: Path, window_seconds: float = ONSET_WINDOW_SECONDS) -> list[float]:
    """
    The loudness of the speech band, once per window, for the whole file.

    One FFmpeg pass building a list whose index is the window number, so a time
    lookup later is arithmetic rather than a search. Returns an empty list if
    the probe fails, which turns the refinement below into a no-op — the same
    failing-open that `silent_spans` does, and for the same reason.
    """
    samples = int(16000 * window_seconds)
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


# Refining each word's start, which is what a caption starts on.
#
# Whisper starts a word where the one before it ended, so a short pause goes
# to the word after it: on the Hindi tutorial "और" was timed from 13.16 s, at
# the end of "करेगी", and is said at 13.52 after 0.34 s of room tone, and its
# caption came up 0.36 s early. The pause is plain at a 20 ms resolution (10 to
# 15 dB under the word before) and invisible at the 250 ms one above. A word
# whose first WORD_PAUSE_LEAD_MS run into a quiet stretch of WORD_PAUSE_MS or
# more starts where the voice comes back. Quiet is measured against the sound
# the word was timed to start on, since room tone sits anywhere from 10 to
# 30 dB down; at 8 dB the tutorial's captions came out the same, at 12 dB the
# 0.36 s stayed. Shorter stretches are left alone: a stop consonant's closure
# is quiet for 50-100 ms inside a word.
#
# Measured against forced-aligned truth on the first 61 s (32 captions): before,
# mean -0.12 s and 3 captions more than 0.2 s early (worst -0.36); after, mean
# -0.09 s, worst -0.20 s early and +0.09 s late.
WORD_ONSET_WINDOW_MS = 20
WORD_PAUSE_DB = 10.0
WORD_PAUSE_MS = 200
WORD_PAUSE_LEAD_MS = 150
WORD_SPEAKING_PERCENTILE = 0.8


def _words_on_onsets(segments: list[Segment], levels: list[float]) -> list[Segment]:
    """
    Each segment's words with their starts on the voice: after a pause the
    word swallowed (above), and the first no earlier than the segment's own
    start when `_snap_to_onset` moved that inside it — the song whose first
    word was timed into the instrumental before it.
    """
    if not levels:
        return segments

    def level(ms: int) -> float:
        index = ms // WORD_ONSET_WINDOW_MS
        return levels[index] if 0 <= index < len(levels) else SILENT_DB

    for segment in segments:
        words = []
        body = sorted(
            level(ms) for ms in range(segment.speech[0][0], segment.speech[-1][1], WORD_ONSET_WINDOW_MS)
        ) or [SILENT_DB]
        speaking = body[int(len(body) * WORD_SPEAKING_PERCENTILE)]
        for position, (start, end, word) in enumerate(segment.speech):
            if position == 0 and start < segment.start_ms < end:
                start = segment.start_ms
            # The voice may come back as late as the next word's start: Whisper
            # can time a word wholly inside the pause before it.
            following = segment.speech[position + 1][0] if position + 1 < len(segment.speech) else end
            reference = max(
                speaking,
                *(level(ms) for ms in range(start, start + 3 * WORD_ONSET_WINDOW_MS, WORD_ONSET_WINDOW_MS)),
            )
            ms = start
            while ms < min(end, start + WORD_PAUSE_LEAD_MS) and level(ms) >= reference - WORD_PAUSE_DB:
                ms += WORD_ONSET_WINDOW_MS
            if ms < min(end, start + WORD_PAUSE_LEAD_MS):
                quiet_from = ms
                # Quiet from its very start, the word may sit wholly in the
                # pause ("You" timed 0.48 s early); after a little sound, that
                # is the word before trailing off, and the voice has to come
                # back inside this word ("और"). If it doesn't, the sound was
                # this word, said quickly before the pause ("two,").
                limit = max(end, following) if quiet_from == start else end
                while ms < limit and level(ms) < reference - WORD_PAUSE_DB:
                    ms += WORD_ONSET_WINDOW_MS
                if ms <= limit and level(ms) >= reference - WORD_PAUSE_DB and ms - quiet_from >= WORD_PAUSE_MS:
                    start = ms
                    end = max(end, start + 1)
            else:
                # Already voiced: if the voice arrived just before, after a
                # pause, the word starts there ("Finally" timed 80 ms after it).
                earliest = max(words[-1][1] if words else 0, start - WORD_PAUSE_LEAD_MS)
                ms = start
                while ms - WORD_ONSET_WINDOW_MS >= earliest and level(ms - WORD_ONSET_WINDOW_MS) >= reference - WORD_PAUSE_DB:
                    ms -= WORD_ONSET_WINDOW_MS
                onset = ms
                while ms - WORD_ONSET_WINDOW_MS >= 0 and level(ms - WORD_ONSET_WINDOW_MS) < reference - WORD_PAUSE_DB:
                    ms -= WORD_ONSET_WINDOW_MS
                if onset < start and onset - WORD_ONSET_WINDOW_MS >= earliest and onset - ms >= WORD_PAUSE_MS:
                    start = onset
            words.append((start, end, word))
        segment.speech = words
    return segments


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


def extract_audio(source: Path, destination: Path, seconds: float | None = None) -> None:
    """
    Pull a 16kHz mono WAV out of the video (the first `seconds` of it, if given).

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
    streams = main_streams(source)

    destination.parent.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        [
            "ffmpeg", "-y",
            *media.input_options(),
            "-i", str(source),
            *streams.map_audio(),  # the main sound only; nothing else is decoded
            "-acodec", "pcm_s16le",
            "-ar", "16000",     # 16kHz, what Whisper expects
            "-ac", "1",         # mono
            *(["-t", str(seconds)] if seconds else []),
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

    # Two measurements of the same audio, once up front rather than per
    # segment, asking different questions. `levels` is "when does the voice
    # arrive": silence detection cannot see a singer entering over an
    # instrumental, because the instrumental is not silent. `spans` is "is
    # there any sound at all", lowered for a recording too quiet for -40dB.
    levels = vocal_envelope(audio_path)
    spans = silence_for(audio_path, levels) if not settings.whisper_vad_filter else []

    segments, info = _decode(model, audio_path, language, task, spans, levels, on_progress)
    if segments:
        segments = _fill_skipped(model, audio_path, segments, language or info.language, task, spans, levels)
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

    if segments:
        segments = _words_on_onsets(segments, vocal_envelope(audio_path, WORD_ONSET_WINDOW_MS / 1000))
    return segments, info.language or "unknown"


# A stretch this long with no caption is re-decoded on its own. Whisper's
# seek can jump past speech after a window ends on a confused token: on a
# 228-second Hinglish tutorial the full pass captioned "S.R .T." at 8 s and
# nothing again until 29.4 s, and two more 20-second stretches likewise,
# while the same audio cut out and decoded alone gave clean phrases for all
# of it. Silence and music that come back as invented text are dropped by
# the same silence check as everything else.
SKIPPED_GAP_SECONDS = 4.0


# Re-decoding a stretch can stop early the same way, so what is still
# uncaptioned inside it is decoded again, from where the last caption ended.
# Each level only ever looks at a smaller stretch, and stops when one finds
# nothing new.
SKIPPED_DEPTH = 3

# A shorter stretch is decoded again too when it is mostly speech (v1.0.10).
# Whisper can file a stretch under a segment that holds only its first few
# words: on the Hinglish tutorial large-v3 gave 8.3-27.6 s as "जाया आपकी
# ओडियो इंदी में क्यों ना हो", and once the last word was capped the 2.1 s
# after it ("manually koi text likhna nahi padta hai") had no caption, too
# short for the 4 s rule. Decoded alone it came back word for word. Voiced
# means the speech band within VOICED_DB of the clip's speaking level (the
# 80th percentile of its louder half), counted in ONSET_WINDOW_SECONDS
# windows whose middle is inside the stretch.
UNCAPTIONED_SPEECH_SECONDS = 0.7
VOICED_DB = 18.0


def _speaking_level(levels: list[float]) -> float:
    louder = sorted(levels)[len(levels) // 2:]
    return louder[int(len(louder) * 0.8)] if louder else SILENT_DB


def _voiced_seconds(start: float, end: float, levels: list[float], speaking: float) -> float:
    """How much of `start`-`end` is at speaking level, in whole envelope windows."""
    first = int(start / ONSET_WINDOW_SECONDS + 0.5)
    last = int(end / ONSET_WINDOW_SECONDS - 0.5)
    windows = levels[max(0, first): max(0, last + 1)]
    return sum(1 for level in windows if level >= speaking - VOICED_DB) * ONSET_WINDOW_SECONDS


def _said(segment: Segment) -> tuple[float, float]:
    """When a segment's words were said, in seconds: what its captions are timed to."""
    timed = [(s, e) for s, e, w in segment.speech if w]
    if not timed:
        return segment.start_ms / 1000, segment.end_ms / 1000
    return timed[0][0] / 1000, timed[-1][1] / 1000


def _bare(word: str) -> str:
    return word.strip(".,;:!?…।॥\"'“”‘’()[]—–-").lower()


def _repeated(tail: list[str], head: list[str]) -> int:
    """
    How many words at the end of `tail` the start of `head` says again.

    A stretch decoded alone can hear the edge of its neighbour, whose words
    were timed a little late or early: the 2.1 s recovered at 25.5 s ended
    "…सबसे पहले हम" and the next segment began "हम यहीं". One word in four
    may differ, for the same word spelled in another script ("set", "सेट").
    """
    for size in range(min(len(tail), len(head), 6), 0, -1):
        pairs = list(zip(tail[-size:], head[:size]))
        if sum(_bare(a) != _bare(b) for a, b in pairs) <= size // 4:
            return size
    return 0


def _without(segment: Segment, count: int, from_start: bool) -> Segment | None:
    """The segment with `count` words dropped from one end, or None if nothing is left."""
    words = segment.text.split()
    if count >= len(words):
        return None
    timed = [item for item in segment.speech if item[2]]
    keep = words[count:] if from_start else words[:-count]
    # Its timings lose the same words when they line up one to one.
    if len(timed) == len(words):
        timed = timed[count:] if from_start else timed[:-count]
    return Segment(
        start_ms=timed[0][0] if from_start and timed else segment.start_ms,
        end_ms=timed[-1][1] if not from_start and timed else segment.end_ms,
        text=" ".join(keep),
        confidence=segment.confidence,
        speech=timed or segment.speech,
    )


def _fill_skipped(
    model, audio_path, segments, language, task, spans, levels,
    within: tuple[float, float] | None = None, depth: int = 0,
) -> list[Segment]:
    """`segments` with every long uncaptioned stretch decoded on its own and merged in."""
    lo, hi = within if within is not None else (0.0, _duration(audio_path))
    speaking = _speaking_level(levels)
    segments = list(segments)
    filled: list[Segment] = []
    # Between the words, not the segments' own bounds: a start the onset
    # snap moved past the first word left a "gap" that was that word, and
    # decoding it again said it twice ("Hamko bas. Hamko bas SRT file").
    bounds = [lo] + [_said(s)[1] for s in segments]
    starts = [_said(s)[0] for s in segments] + [hi]
    for index, (gap_start, gap_end) in enumerate(zip(bounds, starts)):
        voiced = _voiced_seconds(gap_start, gap_end, levels, speaking) if levels else 0.0
        if gap_end - gap_start >= SKIPPED_GAP_SECONDS or voiced > UNCAPTIONED_SPEECH_SECONDS:
            found = _decode_stretch(model, audio_path, gap_start, gap_end, language, task, spans, levels)
            if not found and voiced > UNCAPTIONED_SPEECH_SECONDS:
                # Never invented: what Whisper won't say stays empty.
                logger.info(
                    "%.1f s of speech at %.1f-%.1fs gave nothing usable; left uncaptioned",
                    voiced, gap_start, gap_end,
                )
            if found and depth + 1 < SKIPPED_DEPTH:
                found = _fill_skipped(
                    model, audio_path, found, language, task, spans, levels,
                    within=(gap_start, gap_end), depth=depth + 1,
                )
            # Said once: what the recovered speech repeats of the segment
            # before goes from it, and what the segment after repeats of it
            # goes from that one, whose copy is the one timed late.
            if found and filled:
                repeat = _repeated(filled[-1].text.split(), found[0].text.split())
                if repeat:
                    trimmed = _without(found[0], repeat, from_start=True)
                    found = ([trimmed] if trimmed else []) + found[1:]
            if found and index < len(segments):
                repeat = _repeated(found[-1].text.split(), segments[index].text.split())
                if repeat:
                    trimmed = _without(segments[index], repeat, from_start=True)
                    if trimmed is None:
                        segments[index] = found[-1]
                        found = found[:-1]
                    else:
                        segments[index] = trimmed
            filled.extend(found)
        if index < len(segments):
            filled.append(segments[index])
    filled.sort(key=lambda s: s.start_ms)
    # Never overlapping: a recovered segment ends where the next one starts.
    for a, b in zip(filled, filled[1:]):
        if a.end_ms > b.start_ms:
            a.end_ms = max(a.start_ms + 1, b.start_ms)
            a.speech = [(s, min(e, a.end_ms), w) for s, e, w in a.speech if s < a.end_ms] or [
                (a.start_ms, a.end_ms, "")
            ]
    return filled


def _decode_stretch(model, audio_path, start, end, language, task, spans, levels) -> list[Segment]:
    """The segments Whisper finds in `start`-`end` of the audio, decoded alone."""
    clip = audio_path.with_suffix(f".{int(start * 1000)}-{int(end * 1000)}.wav")
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t",
             f"{end - start:.3f}", "-i", str(audio_path), str(clip)],
            capture_output=True, timeout=120, check=True,
        )
        found, _ = _decode(model, clip, language, task, spans, levels, None, offset=start)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Could not re-decode %.1f-%.1fs: %s", start, end, exc)
        return []
    finally:
        clip.unlink(missing_ok=True)
    # A margin at both ends: the onset snap may nudge a start up to
    # ONSET_LOOKBACK_SECONDS earlier, and without one, the first segment found
    # at 77.48 s, snapped to 77.25 s, was thrown away with its words.
    found = [f for f in found if start - 0.5 <= f.start_ms / 1000 and f.end_ms / 1000 <= end + 0.5]
    if found:
        logger.info("Recovered %d segment(s) between %.1fs and %.1fs", len(found), start, end)
    return found


def _duration(audio_path: Path) -> float:
    """The audio's length in seconds, or 0 if it can't be read."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio_path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        return float(out)
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0.0


def _decode(model, audio_path, language, task, spans, levels, on_progress, offset: float = 0.0, **options):
    """
    One Whisper pass, filtered and retimed into caption segments.

    `offset`: where `audio_path` starts in the video, for a stretch cut out
    of it (`_fill_skipped`); every time is moved by it.
    """
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
        # Each 30-second window decoded on its own audio, not primed with the
        # last one's text. Primed, a window that ended on a garbled token
        # dragged the next ones after it: on the Hinglish tutorial two
        # 20-second stretches of speech came back empty, and without it none.
        condition_on_previous_text=False,
        **options,
    )

    total_seconds = info.duration or 0
    segments: list[Segment] = []
    dropped = 0

    for index, segment in enumerate(_iter(_shifted(segment, offset) for segment in raw_segments)):
        text = segment.text.strip()
        if text:
            # Tighten to the words before anything else looks at the timings:
            # the silence checks below are only as good as the bounds they are
            # handed, and Whisper's own can be tens of seconds wide of the
            # speech they describe.
            start, end = _spoken_bounds(segment)
            # The words as Whisper timed them, before the start is moved below:
            # captions are timed to these. Clipped to the snapped start, the
            # first words of 18 of 89 segments of a Hindi talk fell off, and
            # their captions drifted up to 2.6 s late.
            words = _speech(segment, start, end)

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
                        speech=words,
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
        yield from _split_long(_with_plausible_words(segment))


# The longest a single word's timing is believed. Alignment can hand the
# last word before a pause the whole pause: on the Hinglish tutorial ".T."
# (the end of "S.R.T.") ran from 8.1 to 19.1 s and "हैं।" from 66.0 to 87.8 s,
# and each was then split off as a caption of its own holding all of it. A
# held sung note can be long, so this is generous; nothing spoken is near it.
WORD_MAX_SECONDS = 3.0


def _speech(segment, start: float, end: float) -> list[tuple[int, int, str]]:
    """The segment's words as (start_ms, end_ms, word), kept inside `start`-`end`."""
    out = []
    for word in getattr(segment, "words", None) or []:
        if word.start is None or word.end is None or not word.word.strip():
            continue
        s, e = max(word.start, start), min(word.end, end)
        # Whisper times a short word at zero length ("और" at 32.68-32.68 on
        # the Hindi tutorial); dropped, the caption it starts began on the
        # word after it.
        if e >= s:
            out.append((int(s * 1000), max(int(e * 1000), int(s * 1000) + 1), word.word.strip()))
    return out or [(int(start * 1000), int(end * 1000), "")]


def _with_plausible_words(segment):
    """The segment with no word timed longer than WORD_MAX_SECONDS."""
    words = getattr(segment, "words", None) or []
    if not any(w.start is not None and w.end is not None and w.end - w.start > WORD_MAX_SECONDS for w in words):
        return segment
    capped = [
        SimpleNamespace(
            start=w.start, word=w.word, probability=getattr(w, "probability", None),
            end=(min(w.end, w.start + WORD_MAX_SECONDS) if w.start is not None and w.end is not None else w.end),
        )
        for w in words
    ]
    ends = [w.end for w in capped if w.end is not None]
    return SimpleNamespace(
        text=segment.text, start=segment.start, words=capped,
        end=min(segment.end, max(ends)) if ends else segment.end,
        avg_logprob=getattr(segment, "avg_logprob", None),
    )


def _shifted(segment, offset: float):
    """The segment, and its words, `offset` seconds later."""
    if not offset:
        return segment
    words = [
        SimpleNamespace(
            start=None if w.start is None else w.start + offset,
            end=None if w.end is None else w.end + offset,
            word=w.word, probability=getattr(w, "probability", None),
        )
        for w in (getattr(segment, "words", None) or [])
    ]
    return SimpleNamespace(
        text=segment.text, start=segment.start + offset, end=segment.end + offset,
        words=words, avg_logprob=getattr(segment, "avg_logprob", None),
    )


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
