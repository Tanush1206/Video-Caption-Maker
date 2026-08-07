"""
Media inspection via FFmpeg.

Runs as a subprocess rather than through a Python binding: FFmpeg is already
in the image for Milestone 4, the CLI is stable, and a crash on a malformed
file kills the subprocess instead of the API worker.

Everything here is best-effort. A video that won't probe is still a valid
upload — it just shows no duration until someone looks at it.
"""

import array
import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Probing a damaged or huge file can hang; always bound it.
PROBE_TIMEOUT_SECONDS = 30
THUMBNAIL_TIMEOUT_SECONDS = 60
WAVEFORM_TIMEOUT_SECONDS = 300

# The waveform is drawn a few hundred pixels tall at most, so the audio is
# decoded at a rate far below anything you'd listen to. 4 kHz still resolves
# individual syllables, which is all the timeline needs, and it keeps an hour
# of audio under 30 MB of PCM instead of several gigabytes.
WAVEFORM_SAMPLE_RATE = 4000
WAVEFORM_BUCKETS = 2000

_INT16_MAX = 32768.0


async def _run(*args: str, timeout: int) -> tuple[int, bytes, bytes]:
    """Run a command, returning (returncode, stdout, stderr)."""
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise

    return process.returncode or 0, stdout, stderr


async def probe_duration_ms(path: Path) -> int | None:
    """Duration in milliseconds, or None if the file can't be read."""
    try:
        code, stdout, stderr = await _run(
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(path),
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (asyncio.TimeoutError, FileNotFoundError) as exc:
        logger.warning("ffprobe failed for %s: %s", path.name, exc)
        return None

    if code != 0:
        logger.warning("ffprobe exited %s for %s: %s", code, path.name, stderr[:200])
        return None

    try:
        seconds = float(json.loads(stdout)["format"]["duration"])
    except (KeyError, ValueError, TypeError) as exc:
        logger.warning("Could not parse ffprobe output for %s: %s", path.name, exc)
        return None

    return int(seconds * 1000)


async def generate_thumbnail(
    source: Path, destination: Path, at_ms: int | None = None
) -> bool:
    """
    Write a single JPEG frame to `destination`. Returns whether it worked.

    Seeks to 10% in rather than 0s, because the first frame of a video is very
    often black or a fade-in, which makes for a useless thumbnail.
    """
    seek_seconds = (at_ms / 1000 * 0.1) if at_ms else 1.0

    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        code, _, stderr = await _run(
            "ffmpeg",
            "-y",                       # overwrite without prompting
            "-ss", f"{seek_seconds:.3f}",  # before -i: fast keyframe seek
            "-i", str(source),
            "-frames:v", "1",
            "-vf", "scale=480:-2",      # -2 keeps aspect ratio, even-numbered
            "-q:v", "4",
            str(destination),
            timeout=THUMBNAIL_TIMEOUT_SECONDS,
        )
    except (asyncio.TimeoutError, FileNotFoundError) as exc:
        logger.warning("Thumbnail generation failed for %s: %s", source.name, exc)
        return False

    if code != 0 or not destination.exists():
        logger.warning("ffmpeg exited %s for %s: %s", code, source.name, stderr[:200])
        return False

    return True


def _peak(samples: array.array) -> float:
    """Loudest absolute amplitude in a bucket, as a 0..1 fraction."""
    # max() and min() over an array.array run in C. That matters here: an hour
    # of audio is millions of samples, and a Python-level loop over them takes
    # seconds rather than milliseconds.
    loudest = max(max(samples), -min(samples))
    return loudest / _INT16_MAX


async def extract_waveform_peaks(
    source: Path, duration_ms: int | None, buckets: int = WAVEFORM_BUCKETS
) -> list[float]:
    """
    Downsample the audio track to `buckets` amplitude peaks in the range 0..1.

    Returns an empty list when the file has no audio or FFmpeg fails. A
    timeline without a waveform is still perfectly usable, so this never
    raises — the caller gets caption blocks on a plain background.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-v", "error",
            "-i", str(source),
            "-vn",                             # ignore the video stream entirely
            "-ac", "1",                        # downmix to mono
            "-ar", str(WAVEFORM_SAMPLE_RATE),
            "-f", "s16le",                     # raw little-endian 16-bit PCM
            "-",                               # ...written to stdout
            stdout=asyncio.subprocess.PIPE,
            # An unread pipe fills its buffer and deadlocks the child. We only
            # need the exit code from this one, so discard it rather than
            # having to drain two streams concurrently.
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError:
        logger.warning("ffmpeg is not installed; skipping waveform for %s", source.name)
        return []

    # Bucket width comes from the duration we already know. The alternative is
    # buffering the entire stream just to count samples before dividing it up.
    expected_samples = int((duration_ms or 0) / 1000 * WAVEFORM_SAMPLE_RATE)
    per_bucket = (
        max(1, expected_samples // buckets) if expected_samples else WAVEFORM_SAMPLE_RATE
    )

    async def consume() -> list[float]:
        assert process.stdout is not None
        collected: list[float] = []
        pending = array.array("h")
        leftover = b""

        while chunk := await process.stdout.read(1 << 16):
            data = leftover + chunk
            # A read can land mid-sample; 16-bit frames are two bytes wide, so
            # carry any odd trailing byte into the next chunk.
            usable = len(data) - (len(data) % 2)
            leftover = data[usable:]
            pending.frombytes(data[:usable])

            while len(pending) >= per_bucket:
                collected.append(_peak(pending[:per_bucket]))
                del pending[:per_bucket]

        if pending:
            collected.append(_peak(pending))
        return collected

    try:
        peaks = await asyncio.wait_for(consume(), timeout=WAVEFORM_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        logger.warning("Waveform extraction timed out for %s", source.name)
        return []

    await process.wait()

    if process.returncode != 0 or not peaks:
        logger.info("No usable audio in %s (ffmpeg exited %s)", source.name, process.returncode)
        return []

    # The duration estimate is approximate, so the real bucket count drifts a
    # little either way. Pin it to what the caller asked for.
    peaks = peaks[:buckets]
    peaks.extend([0.0] * (buckets - len(peaks)))

    # Scale to fill the available height. A quietly recorded video would
    # otherwise draw as a nearly flat line, hiding exactly the pauses between
    # phrases that make a waveform useful for caption timing.
    loudest = max(peaks)
    scale = 1 / loudest if loudest > 0 else 1.0

    return [round(peak * scale, 4) for peak in peaks]
