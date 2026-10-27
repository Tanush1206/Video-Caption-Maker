"""
Media inspection via FFmpeg.

Runs as a subprocess rather than through a Python binding: FFmpeg is already
in the image for Milestone 4, the CLI is stable, and a crash on a malformed
file kills the subprocess instead of the API worker.

Everything here is best-effort. A video that won't probe is still a valid
upload — it just shows no duration until someone looks at it.

**What FFmpeg may open.** An upload is whatever the user downloaded, and
FFmpeg's parsers are where crafted files do their damage (Debian's 7.1 has
code-execution CVEs in its PNG, Dirac, CFHD, CAF, VobSub, PGS and DVB
parsers, docs/LAUNCH_AUDIT.md S2). So every FFmpeg run on a user's file:

- reads only local files (`-protocol_whitelist`): no URLs, no playlists;
- uses only the demuxers of the six extensions we accept
  (`-format_whitelist`): no concat lists, HLS, CAF, WTV…;
- may decode only common video and audio codecs (`-codec_whitelist`);
- and names its streams (`-map`): the main picture and the main sound. Cover
  art and picture subtitles are skipped, never decoded, and the video gets a
  note saying so (`Streams.ignored_note`).

Which streams those are is read from the container's headers alone
(`inspect`, `-nofind_stream_info`): nothing is decoded to find out.
"""

import array
import asyncio
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# The demuxers behind .mp4 .m4v .mov (one family), .mkv .webm and .avi.
FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi"

# Codecs a main stream may be in, by the name ffprobe reports. A picture in
# anything else (PNG, Dirac, CFHD…) is refused at upload.
VIDEO_CODECS = frozenset({
    "h264", "hevc", "av1", "vp8", "vp9", "mpeg4", "mpeg2video", "mpeg1video",
    "mjpeg", "prores", "dvvideo", "h263", "msmpeg4v3",
})
AUDIO_CODECS = frozenset({
    "aac", "aac_latm", "mp3", "mp2", "opus", "vorbis", "flac", "alac", "ac3",
    "eac3", "dts", "amr_nb", "amr_wb", "pcm_s16le", "pcm_s16be", "pcm_s24le",
    "pcm_s24be", "pcm_s32le", "pcm_s32be", "pcm_f32le", "pcm_f32be", "pcm_u8",
    "pcm_alaw", "pcm_mulaw",
})

# The decoders FFmpeg picks for those codecs (decoder names, not codec names:
# several codecs have a native and a library decoder).
DECODERS = ",".join([
    "h264", "hevc", "av1", "libdav1d", "vp8", "libvpx", "vp9", "libvpx-vp9",
    "mpeg4", "mpeg2video", "mpeg1video", "mjpeg", "prores", "dvvideo", "h263",
    "msmpeg4v3",
    "aac", "aac_fixed", "aac_latm", "mp3float", "mp3", "mp2float", "mp2",
    "opus", "libopus", "vorbis", "libvorbis", "flac", "alac", "ac3",
    "ac3_fixed", "eac3", "dca", "amrnb", "amrwb", "pcm_s16le", "pcm_s16be",
    "pcm_s24le", "pcm_s24be", "pcm_s32le", "pcm_s32be", "pcm_f32le",
    "pcm_f32be", "pcm_u8", "pcm_alaw", "pcm_mulaw",
])

# Subtitles drawn as pictures. Text subtitles are skipped silently; these
# earn a note, because a viewer might wonder where they went.
PICTURE_SUBTITLES = frozenset({"dvd_subtitle", "hdmv_pgs_subtitle", "dvb_subtitle", "xsub"})

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


def container_options() -> list[str]:
    """Before `-i`: local files only, in one of the accepted containers."""
    return ["-protocol_whitelist", "file,pipe", "-format_whitelist", FORMATS]


def input_options() -> list[str]:
    """Before `-i` of a user's file in any FFmpeg run that decodes it."""
    return [*container_options(), "-codec_whitelist", DECODERS]


@dataclass(frozen=True)
class Streams:
    """The streams of an upload that FFmpeg will touch, from its headers."""

    video: int | None
    audio: int | None
    width: int | None
    height: int | None
    duration_ms: int | None
    cover_image: bool = False
    picture_subtitles: bool = False
    # A picture or sound in a codec we don't decode: refused, not skipped.
    unsupported_video: str | None = None
    unsupported_audio: str | None = None

    @property
    def refusal(self) -> str | None:
        """Why this upload can't be used, in words for the user, or None."""
        if self.video is None and self.unsupported_video:
            return (
                f"This video's picture is in a format VideoCaptionMaker doesn't open "
                f"({self.unsupported_video}). Convert it to MP4 (H.264) and upload it again."
            )
        if self.video is None and self.cover_image:
            return (
                "This file has only a still cover image, not a video. "
                "Upload the video itself."
            )
        return None

    @property
    def ignored_note(self) -> str | None:
        """The note a video gets when streams were skipped, or None."""
        skipped = [
            name
            for name, present in (
                ("cover image", self.cover_image),
                ("picture subtitles", self.picture_subtitles),
            )
            if present
        ]
        if not skipped:
            return None
        verb = "was" if skipped == ["cover image"] else "were"
        return f"This file's {' and '.join(skipped)} {verb} ignored."

    def map_video(self) -> list[str]:
        return ["-map", f"0:{self.video}"] if self.video is not None else []

    def map_audio(self) -> list[str]:
        return ["-map", f"0:{self.audio}"] if self.audio is not None else []


def _seconds(value) -> float | None:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def inspect(path: Path) -> Streams | None:
    """
    The main picture and sound of a user's file, or None if it can't be read.

    Header-only (`-nofind_stream_info`): ffprobe opens the container and lists
    what it declares, without decoding a single packet. A codec allow-list
    can't be used here — ffprobe gives up on the whole file at the first
    stream it may not decode — so this is the one FFmpeg run with no
    `-codec_whitelist`, and the reason it reads headers only.
    """
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                *container_options(),
                "-nofind_stream_info",
                "-show_entries",
                "format=duration:stream=index,codec_type,codec_name,width,height,duration"
                ":stream_disposition=attached_pic,default,timed_thumbnails",
                "-of", "json",
                str(path),
            ],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("ffprobe failed for %s: %s", path.name, exc)
        return None
    if result.returncode != 0:
        logger.warning(
            "ffprobe exited %s for %s: %s",
            result.returncode, path.name, result.stderr.decode("utf-8", "replace")[:200],
        )
        return None
    try:
        data = json.loads(result.stdout)
    except ValueError:
        return None

    video = audio = None
    width = height = None
    cover = pictures = False
    odd_video = odd_audio = None
    default_audio = None
    for stream in data.get("streams", []):
        kind, codec = stream.get("codec_type"), stream.get("codec_name")
        flags = stream.get("disposition") or {}
        if kind == "video":
            if flags.get("attached_pic") or flags.get("timed_thumbnails"):
                cover = True
            elif codec in VIDEO_CODECS:
                if video is None:
                    video, width, height = stream["index"], stream.get("width"), stream.get("height")
            else:
                odd_video = odd_video or codec or "unknown"
        elif kind == "audio":
            if codec in AUDIO_CODECS:
                if audio is None:
                    audio = stream["index"]
                if default_audio is None and flags.get("default"):
                    default_audio = stream["index"]
            else:
                odd_audio = odd_audio or codec or "unknown"
        elif kind == "subtitle" and codec in PICTURE_SUBTITLES:
            pictures = True

    audio = default_audio if default_audio is not None else audio
    streams = {s["index"]: s for s in data.get("streams", [])}
    seconds = _seconds((data.get("format") or {}).get("duration")) or max(
        (_seconds(streams[i].get("duration")) or 0 for i in (video, audio) if i is not None),
        default=0,
    )
    main = video if video is not None else audio
    if not seconds and main is not None:
        seconds = _scanned_seconds(path, main)

    return Streams(
        video=video,
        audio=audio,
        width=int(width) if width else None,
        height=int(height) if height else None,
        duration_ms=int(seconds * 1000) if seconds else None,
        cover_image=cover,
        picture_subtitles=pictures,
        unsupported_video=odd_video if video is None else None,
        unsupported_audio=odd_audio if audio is None else None,
    )


def _scanned_seconds(path: Path, index: int) -> float | None:
    """
    The length of one stream, by reading its packets to the end.

    Only for files whose headers give no length (a WebM straight out of a
    browser's recorder, some AVIs). Packets are copied to nowhere, never
    decoded, so this costs one read of the file.
    """
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-v", "error", *input_options(), "-i", str(path),
                "-map", f"0:{index}", "-c", "copy", "-f", "null", "-",
                "-progress", "pipe:1", "-nostats",
            ],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    times = [
        line.split("=", 1)[1]
        for line in result.stdout.decode("ascii", "replace").splitlines()
        if line.startswith("out_time_us=")
    ]
    try:
        return _seconds(int(times[-1]) / 1_000_000) if times else None
    except ValueError:
        return None


async def probe(path: Path) -> Streams | None:
    """`inspect` off the event loop."""
    return await asyncio.to_thread(inspect, path)


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
    streams = await probe(path)
    return streams.duration_ms if streams else None


async def probe_dimensions(path: Path) -> tuple[int, int] | None:
    """
    The main video stream's pixel width and height, or None if unreadable.

    Needed by the burn-in render: libass scales what it draws to the ASS
    canvas, so `PlayResX/Y` has to be the real frame size or the exported
    captions come out a different size from the preview.
    """
    streams = await probe(path)
    if streams is None or not streams.width or not streams.height:
        return None
    return streams.width, streams.height


async def generate_thumbnail(
    source: Path, destination: Path, at_ms: int | None = None
) -> bool:
    """
    Write a single JPEG frame to `destination`. Returns whether it worked.

    Seeks to 10% in rather than 0s, because the first frame of a video is very
    often black or a fade-in, which makes for a useless thumbnail. Always from
    the main video stream: a cover image is never the thumbnail.
    """
    streams = await probe(source)
    if streams is None or streams.video is None:
        return False

    seek_seconds = (at_ms / 1000 * 0.1) if at_ms else 1.0

    destination.parent.mkdir(parents=True, exist_ok=True)

    try:
        code, _, stderr = await _run(
            "ffmpeg",
            "-y",                       # overwrite without prompting
            "-ss", f"{seek_seconds:.3f}",  # before -i: fast keyframe seek
            *input_options(),
            "-i", str(source),
            *streams.map_video(),
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
    streams = await probe(source)
    if streams is None or streams.audio is None:
        return []

    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-v", "error",
            *input_options(),
            "-i", str(source),
            *streams.map_audio(),              # the main sound, nothing else
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
