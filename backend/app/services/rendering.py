"""
Burning captions into video with FFmpeg.

The one operation in this application that re-encodes anything, so the settings
are chosen to give up as little as possible.
"""

import logging
import re
import subprocess
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

RENDER_TIMEOUT_SECONDS = 60 * 60 * 3

# Constant Rate Factor. 18 is the usual "visually indistinguishable from the
# source" point for x264: low enough that re-encoding is not what anyone
# notices, high enough that the file stays a sane size. Note it targets a
# *quality*, not a bitrate, so a clean source gets a small file and a noisy one
# gets a large one — which is the behaviour you want when the instruction is
# "don't make it look worse".
CRF = 18

# FFmpeg reports progress as microseconds of output written.
_OUT_TIME = re.compile(rb"out_time_us=(\d+)")


def burn_captions(
    source: Path,
    subtitle_file: Path,
    destination: Path,
    *,
    duration_ms: int | None,
    on_progress: Callable[[int], None] | None = None,
) -> None:
    """
    Render `source` with `subtitle_file` drawn into the frames.

    Raises RuntimeError on failure. Progress is reported 0-100 when the
    duration is known.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg", "-y",
        "-i", str(source),
        # libass draws onto the decoded frames. There is no way to burn text in
        # without re-encoding the video — the pixels themselves change.
        "-vf", f"subtitles={_escape_filter_path(subtitle_file)}",
        "-c:v", "libx264",
        "-crf", str(CRF),
        "-preset", "medium",
        # Match the compatibility baseline of the uploads we accept. Without
        # it, a source in a less common pixel format produces output some
        # players refuse.
        "-pix_fmt", "yuv420p",
        # The whole point: the audio track is copied through untouched, never
        # decoded and re-encoded. Deliberately not "-c:a aac".
        "-c:a", "copy",
        # Put the moov atom at the front so the result streams and seeks
        # without downloading the whole file first.
        "-movflags", "+faststart",
        # Machine-readable progress on stdout.
        "-progress", "pipe:1",
        "-nostats",
        str(destination),
    ]

    logger.info("Rendering %s -> %s", source.name, destination.name)

    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    try:
        _follow_progress(process, duration_ms, on_progress)
        _, stderr = process.communicate(timeout=RENDER_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise RuntimeError("Rendering timed out") from None

    if process.returncode != 0 or not destination.exists():
        destination.unlink(missing_ok=True)
        tail = stderr.decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"Rendering failed: {tail}")


def _follow_progress(
    process: subprocess.Popen,
    duration_ms: int | None,
    on_progress: Callable[[int], None] | None,
) -> None:
    """
    Read FFmpeg's progress stream until it closes.

    Also drains stdout, which matters regardless of whether anyone wants the
    numbers: an unread pipe fills its buffer and deadlocks the child.
    """
    if process.stdout is None:
        return

    for line in process.stdout:
        if on_progress is None or not duration_ms:
            continue
        match = _OUT_TIME.search(line)
        if match:
            written_ms = int(match.group(1)) / 1000
            # Capped at 99: the job isn't done until the file is closed and
            # the process has exited cleanly.
            on_progress(min(int(written_ms / duration_ms * 100), 99))


def _escape_filter_path(path: Path) -> str:
    """
    Quote a path for the `subtitles=` filter argument.

    FFmpeg's filtergraph parser has its own escaping layer on top of the shell:
    colons separate filter options and backslashes escape. A Windows-style path
    or a filename with a colon in it silently becomes two arguments.
    """
    text = str(path)
    return text.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
