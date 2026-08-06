"""
Media inspection via FFmpeg.

Runs as a subprocess rather than through a Python binding: FFmpeg is already
in the image for Milestone 4, the CLI is stable, and a crash on a malformed
file kills the subprocess instead of the API worker.

Everything here is best-effort. A video that won't probe is still a valid
upload — it just shows no duration until someone looks at it.
"""

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Probing a damaged or huge file can hang; always bound it.
PROBE_TIMEOUT_SECONDS = 30
THUMBNAIL_TIMEOUT_SECONDS = 60


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
