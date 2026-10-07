"""
Burning captions into video with FFmpeg.

The one operation in this application that re-encodes anything, so the settings
are chosen to give up as little as possible.
"""

import logging
import re
import subprocess
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

RENDER_TIMEOUT_SECONDS = 60 * 60 * 3

# Constant Rate Factor. 18 is the usual "visually indistinguishable from the
# source" point for x264: low enough that re-encoding is not what anyone
# notices, high enough that the file stays a sane size. Note it targets a
# *quality*, not a bitrate, so a clean source gets a small file and a noisy one
# gets a large one — which is the behaviour you want when the instruction is
# "don't make it look worse".
CRF = 18

# NVENC's constant-quality target. Slightly tighter than CRF 18 because NVENC
# is a little less efficient per bit than x264 at the same nominal number.
NVENC_CQ = 19

# FFmpeg reports progress as microseconds of output written.
_OUT_TIME = re.compile(rb"out_time_us=(\d+)")

# The heights offered for a burn, smallest first. Standard broadcast steps
# rather than arbitrary numbers, because a player, a phone and a video site all
# expect these and nothing in between.
RESOLUTION_LADDER: tuple[int, ...] = (360, 480, 720, 1080, 1440, 2160)

# Above this, a burn is minutes of encoding for a file nobody can upload
# anywhere. 2160 is already generous for a captioning tool.
MAX_OUTPUT_HEIGHT = 2160


def target_dimensions(source_width: int, source_height: int, height: int | None) -> tuple[int, int]:
    """
    The frame size to render at, from a requested height.

    `None` means "leave it alone", which stays the default: re-encoding at the
    source's own size is the only choice that cannot make the picture worse.

    The width follows from the source's aspect ratio rather than from a second
    parameter, so the output can never be stretched. Both are forced even —
    yuv420p subsamples chroma by two, and an odd dimension is rejected outright
    by most encoders.
    """
    if height is None or source_height <= 0:
        return source_width, source_height

    height = max(2, min(height, MAX_OUTPUT_HEIGHT))
    width = round(source_width * height / source_height)
    return max(2, width - width % 2), height - height % 2


def available_heights(source_height: int) -> list[int]:
    """
    The ladder steps worth offering for a source of this height.

    Everything up to the cap, including steps above the source. Upscaling adds
    no detail to the picture and is normally pointless — but captions are drawn
    *after* the scale, as vector glyphs at the output size, so rendering a 144p
    source at 1080p genuinely does turn an illegible 6px caption into a sharp
    45px one. The picture stays soft; the text stops being a smudge. The UI
    labels which steps are upscales so that trade is the user's to make.
    """
    steps = [h for h in RESOLUTION_LADDER if h <= MAX_OUTPUT_HEIGHT]
    if source_height and source_height not in steps and source_height <= MAX_OUTPUT_HEIGHT:
        steps.append(source_height)
    return sorted(set(steps))


# The smallest a burned-in caption may end up, in output pixels.
#
# Below roughly this, text stops being readable on a phone and no longer
# survives the re-compression a video gets when it is uploaded anywhere. 24 is
# a deliberately modest floor: it is about the size of body text on a page, and
# a caption is meant to be easier to read than that.
MIN_CAPTION_PX = 24


def recommended_height(source_height: int, font_size: int, reference_height: int) -> int:
    """
    The height to default the picker to.

    Not simply the source's own size, which is the obvious answer and the wrong
    one. Caption sizes are stored against a 1080p canvas and scaled by
    `height / 1080`, so a 256x144 source renders a 48px caption at **6px** —
    unreadable, and unreadable is what pressing the obvious button would then
    produce. A captioning tool defaulting to output whose captions cannot be
    read is failing at the one thing it does.

    So: the smallest step on the ladder at which the caption clears
    MIN_CAPTION_PX, and never below the source's own height — the default may
    upscale to rescue legibility, but it must never quietly throw away detail
    that was there. A source that is already big enough keeps its own size and
    nothing is resampled, which is the common case.
    """
    if source_height <= 0 or font_size <= 0:
        return source_height

    for height in available_heights(source_height):
        if height < source_height:
            continue
        if font_size * height / reference_height >= MIN_CAPTION_PX:
            return height

    # Every step was still too small — only reachable with a tiny font size.
    # The largest offer is the best available answer.
    return max(available_heights(source_height))


@lru_cache(maxsize=1)
def nvenc_available() -> bool:
    """
    Whether NVIDIA's hardware H.264 encoder can actually be opened.

    Probed by encoding one frame, not by reading `ffmpeg -encoders`. The
    listing is compiled in and says nothing about the machine: on a container
    given the GPU without the `video` driver capability, every NVENC encoder is
    listed and every one of them fails on open with "Cannot load
    libnvidia-encode.so.1" — followed by a bogus complaint that the driver is
    too old. A one-frame encode is the only answer that can be trusted.

    Cached because the answer cannot change while the process is alive.
    """
    try:
        probe = subprocess.run(
            [
                "ffmpeg", "-v", "error",
                # 320x240, not something tiny. NVENC refuses frames below a
                # minimum size — a 128x128 probe fails with "Frame Dimension
                # less than the minimum supported value" on a card that encodes
                # 4K perfectly well, and the whole feature silently falls back
                # to the CPU. A probe has to look like the work.
                "-f", "lavfi", "-i", "testsrc=size=320x240:duration=0.1",
                "-c:v", "h264_nvenc", "-f", "null", "-",
            ],
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.info("NVENC probe could not run (%s), using libx264", exc)
        return False

    ok = probe.returncode == 0
    if not ok:
        logger.info(
            "NVENC unavailable, using libx264: %s",
            probe.stderr.decode("utf-8", "replace").strip()[:200],
        )
    else:
        logger.info("NVENC available, using h264_nvenc")
    return ok


def _video_encoder_args() -> list[str]:
    """
    How to encode the video stream, hardware if there is any.

    NVENC is roughly an order of magnitude faster than x264 at these sizes,
    which is what makes rendering a long video at 1080p or 2160p reasonable at
    all. It is slightly less efficient per bit than `x264 -preset medium`, so
    the quality target is set a little tighter (CQ 19) to compensate; `p6` is
    NVENC's second-slowest preset, chosen for the same reason.

    Falls back to x264 with no configuration when there is no usable GPU, so
    the same image runs on a laptop and on a machine with a card in it.
    """
    if nvenc_available():
        return [
            "-c:v", "h264_nvenc",
            "-preset", "p6",
            # Constant quality, the NVENC equivalent of CRF. `-b:v 0` is not
            # optional: without it the bitrate cap stays in force and silently
            # overrides the quality target.
            "-rc", "vbr",
            "-cq", str(NVENC_CQ),
            "-b:v", "0",
        ]
    return ["-c:v", "libx264", "-crf", str(CRF), "-preset", "medium"]


def _filter_chain(subtitle_file: Path, target: tuple[int, int] | None) -> str:
    """
    The scale, then the burn — and that order is the whole point.

    libass draws glyphs as vectors at whatever size the frames are when it runs.
    Put `scale` first and the captions are *rendered* at the output size, sharp.
    Put it second and they are drawn small and then stretched with the picture,
    which is indistinguishable from not offering the option at all.

    It is also why rendering a tiny source at 1080p is worth having: a 256x144
    video puts a 48-reference-pixel caption on screen at 6px, and no amount of
    scaling afterwards can recover that. Scaling first gives it 45px to draw in.

    `flags=lanczos` because the default (bicubic) is soft, and an upscale is
    exactly the case where that shows.
    """
    steps = []
    if target is not None:
        steps.append(f"scale={target[0]}:{target[1]}:flags=lanczos")
    steps.append(
        f"subtitles={_escape_filter_path(subtitle_file)}"
        f":fontsdir={_escape_filter_path(Path(get_settings().font_cache_dir))}"
    )
    return ",".join(steps)


def burn_captions(
    source: Path,
    subtitle_file: Path,
    destination: Path,
    *,
    duration_ms: int | None,
    target: tuple[int, int] | None = None,
    on_progress: Callable[[int], None] | None = None,
) -> None:
    """
    Render `source` with `subtitle_file` drawn into the frames.

    `target` is the output frame size. None renders at the source's own size,
    which is the default and the only choice that cannot soften the picture.

    Raises RuntimeError on failure. Progress is reported 0-100 when the
    duration is known.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg", "-y",
        "-i", str(source),
        # libass draws onto the decoded frames. There is no way to burn text in
        # without re-encoding the video — the pixels themselves change.
        #
        # `fontsdir` is named explicitly rather than left to fontconfig. The
        # on-demand cache is written by the *backend* container and read here,
        # and fontconfig keeps a per-process scan of the directories it knows
        # about — a font downloaded a moment ago can be on disk and still
        # invisible to this worker. Pointing libass straight at the directory
        # skips that entirely.
        "-vf", _filter_chain(subtitle_file, target),
        *_video_encoder_args(),
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
