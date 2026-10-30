"""
Burning captions into video with FFmpeg.

The one operation in this application that re-encodes anything, so the settings
are chosen to give up as little as possible.
"""

import logging
import re
import shlex
import subprocess
import threading
import time
from collections import deque
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from app.config import get_settings
from app.models.export import ExportQuality
from app.services import media

logger = logging.getLogger(__name__)

RENDER_TIMEOUT_SECONDS = 60 * 60 * 3

# How much of FFmpeg's stderr is kept for the error message: its last lines,
# which is where it says why it stopped.
STDERR_TAIL_LINES = 40

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

# How large a burn's picture may be against the source's, by bitrate (v1.2.2).
# The quality targets above still decide the picture; this only stops them
# spending more than the source did. Uncapped, NVENC at CQ 19 turned a
# 3.8 Mbit/s upload into 14.8 Mbit/s (3.9x), and x264 at CRF 18 a WhatsApp
# video into 1.6x, the extra bits copying the source's own compression noise.
# Measured on 2 minutes of that upload (D22): SSIM against the source 0.975
# at 0.7x, 0.985 at 1.2x, 0.991 at 2x, 0.995 uncapped, at the same speed.
QUALITY_FACTORS: dict[ExportQuality, float] = {
    ExportQuality.SMALLER: 0.7,
    ExportQuality.SAME: 1.2,
    ExportQuality.HIGHER: 2.0,
}
QUALITY_LABELS: dict[ExportQuality, str] = {
    ExportQuality.SMALLER: "Smaller file",
    ExportQuality.SAME: "Same as original",
    ExportQuality.HIGHER: "Higher quality",
}

# A smaller frame needs fewer bits, but not in proportion to its area: detail
# per pixel goes up as a picture is scaled down. The usual rule of thumb is
# the area ratio to the power 0.75 (720p from 1080p: 0.44 of the area, 0.54
# of the bitrate).
AREA_EXPONENT = 0.75

# Sound an MP4 plays with everywhere, copied as it is. FFmpeg will also put
# Opus, Vorbis, FLAC or PCM in an MP4 without complaint, and many players
# then play the picture in silence, so those are re-encoded to AAC.
MP4_AUDIO_CODECS = frozenset({"aac", "mp3", "ac3", "eac3", "alac"})
AAC_BIT_RATE = 192_000

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
    The ladder steps worth offering for a source of this height: those up to
    the source's own height, and that height itself.

    Never above it (v1.1.0). An upscale adds no picture detail, only a bigger
    file and a longer encode; it used to be offered because captions are
    drawn after the scale, but a choice that looks like "better quality" and
    isn't was judged worse than small captions on a small source.

    A source that can't be probed (0) gets the whole ladder: there is nothing
    to measure it against.
    """
    if not source_height:
        return [h for h in RESOLUTION_LADDER if h <= MAX_OUTPUT_HEIGHT]
    ceiling = min(source_height, MAX_OUTPUT_HEIGHT)
    steps = [h for h in RESOLUTION_LADDER if h <= ceiling]
    if source_height <= MAX_OUTPUT_HEIGHT and source_height not in steps:
        steps.append(source_height)
    return sorted(set(steps))


def recommended_height(source_height: int) -> int:
    """
    The height to default the picker to: the source's own, so nothing is
    resampled. A source taller than the cap gets the cap.
    """
    if source_height <= 0:
        return source_height
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


def bitrate_cap(
    source_bit_rate: int | None,
    source_size: tuple[int, int],
    output_size: tuple[int, int],
    quality: ExportQuality,
) -> int | None:
    """
    The most the burn's picture may use, in bits/s, or None for no cap.

    None only when the source's rate can't be told, which keeps the old,
    uncapped behaviour rather than guessing a number.
    """
    if not source_bit_rate or not all(source_size) or not all(output_size):
        return None
    area = (output_size[0] * output_size[1]) / (source_size[0] * source_size[1])
    return int(source_bit_rate * QUALITY_FACTORS[quality] * min(area, 1.0) ** AREA_EXPONENT)


def audio_args(codec: str | None) -> list[str]:
    """Copy MP4-friendly sound untouched; re-encode anything else to AAC."""
    if codec is None or codec in MP4_AUDIO_CODECS:
        return ["-c:a", "copy"]
    return ["-c:a", "aac", "-b:a", str(AAC_BIT_RATE)]


def estimated_bytes(
    streams: "media.Streams", output_size: tuple[int, int], quality: ExportQuality
) -> int | None:
    """
    The most a burn should come to, or None if it can't be told.

    An upper bound: the cap is a ceiling, and a clean source can come in under
    it (a 40 Mbit/s camera file burned at 17 Mbit/s against a cap of 48).
    """
    cap = bitrate_cap(
        streams.video_bit_rate, (streams.width or 0, streams.height or 0), output_size, quality
    )
    if cap is None or not streams.duration_ms:
        return None
    if streams.audio is None:
        sound = 0
    elif streams.audio_codec in MP4_AUDIO_CODECS:
        sound = streams.audio_bit_rate or 128_000
    else:
        sound = AAC_BIT_RATE
    return int((cap + sound) * streams.duration_ms / 1000 / 8)


def _video_encoder_args(cap: int | None = None) -> list[str]:
    """
    How to encode the video stream, hardware if there is any.

    NVENC is roughly an order of magnitude faster than x264 at these sizes,
    which is what makes rendering a long video at 1080p or 2160p reasonable at
    all. It is slightly less efficient per bit than x264, so the quality
    target is set a little tighter (CQ 19) to compensate; `p6` is NVENC's
    second-slowest preset, chosen for the same reason.

    Falls back to x264 with no configuration when there is no usable GPU, so
    the same image runs on a laptop and on a machine with a card in it.
    `faster`, not `medium` (v1.2.0, D21): CRF fixes the quality, and the
    preset only trades file size for time. Measured on a 15-minute 1080p30
    video with 4 CPU cores, 120 s of it took 87 s at `medium` and 51 s at
    `faster`, for a file 5% larger: real time with room to spare on a slower
    laptop.

    `cap` (bits/s, v1.2.2) is a ceiling on top of the quality target, with a
    two-second buffer: the target decides the picture until it would spend
    more than the cap allows.
    """
    ceiling = ["-maxrate", str(cap), "-bufsize", str(cap * 2)] if cap else []
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
            *ceiling,
        ]
    return ["-c:v", "libx264", "-crf", str(CRF), "-preset", "faster", *ceiling]


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

    The `ass` filter, not `subtitles`: the same libass renderer, but the only
    one of the two that can ask for **complex shaping**. Under `subtitles`
    libass shapes simply — characters in memory order — so Hindi's ि was drawn
    after its consonant instead of before it, conjuncts showed a bare virama,
    and Bengali, Tamil and Malayalam two-part vowel signs split round a dotted
    circle. Every Indic burn did that until v1.0.7. The file is always ASS
    (`subtitles.to_ass`), which is all `ass` reads.
    """
    steps = []
    if target is not None:
        steps.append(f"scale={target[0]}:{target[1]}:flags=lanczos")
    steps.append(
        f"ass={_escape_filter_path(subtitle_file)}"
        f":fontsdir={_escape_filter_path(Path(get_settings().font_cache_dir))}"
        ":shaping=complex"
    )
    return ",".join(steps)


def burn_captions(
    source: Path,
    subtitle_file: Path,
    destination: Path,
    *,
    duration_ms: int | None,
    target: tuple[int, int] | None = None,
    quality: ExportQuality = ExportQuality.SAME,
    on_progress: Callable[[int], None] | None = None,
) -> None:
    """
    Render `source` with `subtitle_file` drawn into the frames.

    `target` is the output frame size. None renders at the source's own size,
    which is the default and the only choice that cannot soften the picture.
    `quality` caps the picture's bitrate against the source's (v1.2.2).

    Raises RuntimeError on failure. Progress is reported 0-100 when the
    duration is known.
    """
    streams = media.inspect(source)
    if streams is None or streams.video is None:
        raise RuntimeError("Could not read this video's streams")

    destination.parent.mkdir(parents=True, exist_ok=True)

    source_size = (streams.width or 0, streams.height or 0)
    cap = bitrate_cap(streams.video_bit_rate, source_size, target or source_size, quality)

    command = [
        "ffmpeg", "-y",
        *media.input_options(),
        "-i", str(source),
        # The main picture and the main sound, named: a cover image or a
        # subtitle track is never decoded, and never ends up in the export.
        *streams.map_video(),
        *streams.map_audio(),
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
        *_video_encoder_args(cap),
        # Match the compatibility baseline of the uploads we accept. Without
        # it, a source in a less common pixel format produces output some
        # players refuse.
        "-pix_fmt", "yuv420p",
        # The sound is copied through untouched, never decoded and re-encoded,
        # when an MP4 plays it everywhere; only other codecs become AAC.
        *audio_args(streams.audio_codec),
        # Put the moov atom at the front so the result streams and seeks
        # without downloading the whole file first.
        "-movflags", "+faststart",
        # Machine-readable progress on stdout.
        "-progress", "pipe:1",
        "-nostats",
        str(destination),
    ]

    logger.info(
        "Rendering %s -> %s: %s", source.name, destination.name, shlex.join(command)
    )
    started = time.monotonic()

    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    # stderr is read while FFmpeg runs, on its own thread. Until v1.2.0 it was
    # read only once stdout closed, and a pipe holds 64 KB: a source whose
    # decoder warns on every few frames (a YouTube download prints "Late SEI
    # is not implemented", 77 KB over 15 minutes) filled it, FFmpeg blocked
    # on its next warning, and the export sat at 80% for good.
    stderr_tail: deque[bytes] = deque(maxlen=STDERR_TAIL_LINES)
    drain = threading.Thread(target=stderr_tail.extend, args=(process.stderr,), daemon=True)
    drain.start()

    # A timer, because a timeout on the wait afterwards could never fire on a
    # hang: `_follow_progress` doesn't return until FFmpeg closes stdout.
    timed_out = threading.Event()

    def expire() -> None:
        timed_out.set()
        process.kill()

    deadline = threading.Timer(RENDER_TIMEOUT_SECONDS, expire)
    deadline.start()
    try:
        _follow_progress(process, duration_ms, on_progress)
        process.wait()
    finally:
        deadline.cancel()
        if process.poll() is None:
            # Only after an exception from the progress callback: a normal
            # run has already waited for FFmpeg to exit.
            process.kill()
            process.wait()
        drain.join()
        for pipe in (process.stdout, process.stderr):
            if pipe is not None:
                pipe.close()

    if timed_out.is_set():
        destination.unlink(missing_ok=True)
        raise RuntimeError("Rendering timed out")

    if process.returncode != 0 or not destination.exists():
        destination.unlink(missing_ok=True)
        tail = b"".join(stderr_tail).decode("utf-8", "replace")[-400:]
        raise RuntimeError(f"Rendering failed: {tail}")

    elapsed = time.monotonic() - started
    logger.info(
        "Rendered %s in %.0f s (%s real time)",
        destination.name,
        elapsed,
        f"{duration_ms / 1000 / elapsed:.1f}x" if duration_ms and elapsed else "unknown",
    )


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
    Quote a path for the `ass=` filter argument.

    FFmpeg's filtergraph parser has its own escaping layer on top of the shell:
    colons separate filter options and backslashes escape. A Windows-style path
    or a filename with a colon in it silently becomes two arguments.
    """
    text = str(path)
    return text.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
