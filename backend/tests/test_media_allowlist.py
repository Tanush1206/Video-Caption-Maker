"""
FFmpeg reads only what the app needs (services/media.py, LAUNCH_AUDIT.md S2).

Every file here is made by FFmpeg itself (or written byte for byte, for the
hostile ones), so the tests exercise the real demuxers and decoders in the
image rather than a mock of them.
"""

import json
import os
import struct
import subprocess
from pathlib import Path

import pytest

from app.services import media, rendering, transcription

VIDEO = ["-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25"]
AUDIO = ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"]


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True, capture_output=True, timeout=120)


def _streams_of(path: Path) -> list[dict]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", str(path)],
        capture_output=True, check=True,
    ).stdout
    return json.loads(out)["streams"]


def _cover(tmp_path: Path) -> Path:
    """A 64x64 PNG: a different shape from the 320x240 picture, so a thumbnail made from it would show."""
    cover = tmp_path / "cover.png"
    _ffmpeg("-f", "lavfi", "-i", "color=red:size=64x64", "-frames:v", "1", str(cover))
    return cover


def _pgs(tmp_path: Path) -> Path:
    """A minimal PGS (.sup) stream: two empty display sets. FFmpeg can copy PGS but not encode it."""
    def segment(pts: int, kind: int, data: bytes) -> bytes:
        return b"PG" + struct.pack(">IIBH", pts, pts, kind, len(data)) + data

    composition = struct.pack(">HHBHBBBB", 320, 240, 0x10, 0, 0x80, 0, 0, 0)
    sup = tmp_path / "subs.sup"
    sup.write_bytes(b"".join(segment(pts, 0x16, composition) + segment(pts, 0x80, b"") for pts in (0, 90000)))
    return sup


# ── Ordinary videos are read whole ──────────────────────────────────────

NORMAL = {
    "h264.mp4": ["-c:v", "libx264", "-c:a", "aac"],
    "h264.mov": ["-c:v", "libx264", "-c:a", "aac"],
    "h264.m4v": ["-c:v", "libx264", "-c:a", "aac"],
    "h264-opus.mkv": ["-c:v", "libx264", "-c:a", "libopus"],
    "vp9-opus.webm": ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-c:a", "libopus"],
    "mpeg4-mp3.avi": ["-c:v", "mpeg4", "-c:a", "libmp3lame"],
}


@pytest.mark.parametrize("name", NORMAL)
async def test_an_ordinary_video_is_read_whole(name, tmp_path):
    path = tmp_path / name
    _ffmpeg(*VIDEO, *AUDIO, *NORMAL[name], "-shortest", str(path))

    streams = media.inspect(path)

    assert streams is not None
    assert streams.video is not None and streams.audio is not None
    assert (streams.width, streams.height) == (320, 240)
    assert 1500 <= streams.duration_ms <= 2500
    assert streams.refusal is None and streams.ignored_note is None

    assert await media.generate_thumbnail(path, tmp_path / "thumb.jpg", streams.duration_ms)
    transcription.extract_audio(path, tmp_path / "out.wav")
    assert (tmp_path / "out.wav").stat().st_size > 0
    assert len(await media.extract_waveform_peaks(path, streams.duration_ms, buckets=10)) == 10


async def test_a_browser_recording_with_no_length_in_its_headers_still_gets_one(tmp_path):
    """MediaRecorder-style WebM written to a pipe: the length is found by reading the packets."""
    path = tmp_path / "recorded.webm"
    with path.open("wb") as out:
        subprocess.run(
            ["ffmpeg", "-v", "error", *VIDEO, *AUDIO, "-c:v", "libvpx", "-c:a", "libopus",
             "-shortest", "-f", "webm", "-"],
            stdout=out, check=True, timeout=120,
        )

    streams = media.inspect(path)

    assert streams is not None and 1500 <= streams.duration_ms <= 2500


# ── Hostile files never reach a parser that could be fooled ─────────────

HOSTILE = {
    # Playlists naming a local file and an internal address.
    "hls-file.mp4": b"#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n",
    "hls-http.mp4": b"#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nhttp://10.255.255.1/x.ts\n#EXT-X-ENDLIST\n",
    # A concat list naming a local file.
    "concat.mp4": b"ffconcat version 1.0\nfile /etc/passwd\nfile ../../etc/passwd\n",
    "corrupt.mp4": b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + os.urandom(20000),
    "text.mp4": b"hello\n",
}


@pytest.mark.parametrize("name", HOSTILE)
async def test_a_hostile_file_is_not_read(name, tmp_path):
    path = tmp_path / name
    path.write_bytes(HOSTILE[name])

    assert media.inspect(path) is None
    assert not await media.generate_thumbnail(path, tmp_path / "thumb.jpg")
    with pytest.raises(RuntimeError, match="Could not read this video's streams"):
        transcription.extract_audio(path, tmp_path / "out.wav")


def test_a_container_outside_the_six_is_not_opened(tmp_path):
    """CAF (one of the CVE parsers) renamed .mov: refused by the demuxer allow-list."""
    path = tmp_path / "sound.mov"
    _ffmpeg(*AUDIO, "-c:a", "pcm_s16le", "-f", "caf", str(path))

    assert media.inspect(path) is None


@pytest.mark.parametrize("codec, name", [(["-c:v", "png"], "png.mov"), (["-c:v", "vc2"], "dirac.mkv")])
def test_a_picture_in_a_codec_we_do_not_decode_is_refused(codec, name, tmp_path):
    """PNG and Dirac are CVE decoders: as the main picture, the upload is refused, not decoded."""
    path = tmp_path / name
    _ffmpeg(*VIDEO, *AUDIO, *codec, "-c:a", "aac", "-shortest", str(path))

    streams = media.inspect(path)

    assert streams is not None and streams.video is None
    assert "doesn't open" in streams.refusal


# ── Cover art and picture subtitles are skipped, never decoded ──────────


async def test_png_cover_art_is_skipped_and_noted(tmp_path):
    path = tmp_path / "with-cover.mp4"
    _ffmpeg(
        *VIDEO, *AUDIO, "-i", str(_cover(tmp_path)),
        "-map", "0", "-map", "1", "-map", "2",
        "-c:v:0", "libx264", "-c:a", "aac", "-c:v:1", "png", "-disposition:v:1", "attached_pic",
        str(path),  # no -shortest: the one-frame cover would cut the file to 40 ms
    )

    streams = media.inspect(path)

    assert streams is not None and streams.refusal is None
    assert streams.cover_image and (streams.width, streams.height) == (320, 240)
    assert 1500 <= streams.duration_ms <= 2500
    assert streams.ignored_note == "This file's cover image was ignored."

    # The thumbnail is the video's own 4:3 frame, not the square cover.
    thumb = tmp_path / "thumb.jpg"
    assert await media.generate_thumbnail(path, thumb, streams.duration_ms)
    assert (_streams_of(thumb)[0]["width"], _streams_of(thumb)[0]["height"]) == (480, 360)

    transcription.extract_audio(path, tmp_path / "out.wav")

    # The export carries the picture and the sound, and not the cover.
    subtitles = tmp_path / "captions.ass"
    subtitles.write_text(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 240\n\n[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,DejaVu Sans,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hello\n",
        encoding="utf-8",
    )
    exported = tmp_path / "export.mp4"
    rendering.burn_captions(path, subtitles, exported, duration_ms=streams.duration_ms)
    assert sorted(s["codec_type"] for s in _streams_of(exported)) == ["audio", "video"]


async def test_a_pgs_subtitle_track_is_skipped_and_noted(tmp_path):
    path = tmp_path / "with-pgs.mkv"
    _ffmpeg(
        *VIDEO, *AUDIO, "-i", str(_pgs(tmp_path)),
        "-map", "0", "-map", "1", "-map", "2",
        "-c:v", "libx264", "-c:a", "aac", "-c:s", "copy", "-shortest", str(path),
    )
    assert "subtitle" in [s["codec_type"] for s in _streams_of(path)]

    streams = media.inspect(path)

    assert streams is not None and streams.refusal is None
    assert streams.picture_subtitles
    assert streams.ignored_note == "This file's picture subtitles were ignored."
    assert await media.generate_thumbnail(path, tmp_path / "thumb.jpg", streams.duration_ms)
    transcription.extract_audio(path, tmp_path / "out.wav")


async def test_a_text_subtitle_track_is_skipped_quietly(tmp_path):
    srt = tmp_path / "subs.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")
    path = tmp_path / "with-srt.mkv"
    _ffmpeg(
        *VIDEO, *AUDIO, "-i", str(srt), "-map", "0", "-map", "1", "-map", "2",
        "-c:v", "libx264", "-c:a", "aac", "-c:s", "srt", "-shortest", str(path),
    )

    streams = media.inspect(path)

    assert streams is not None and streams.ignored_note is None
    transcription.extract_audio(path, tmp_path / "out.wav")


def test_both_skipped_kinds_share_one_note():
    streams = media.Streams(
        video=0, audio=1, width=1, height=1, duration_ms=1, cover_image=True, picture_subtitles=True
    )
    assert streams.ignored_note == "This file's cover image and picture subtitles were ignored."


def _cover_only(tmp_path: Path) -> bytes:
    path = tmp_path / "song.mp4"
    _ffmpeg(
        *AUDIO, "-i", str(_cover(tmp_path)), "-map", "0", "-map", "1",
        "-c:a", "aac", "-c:v", "png", "-disposition:v:0", "attached_pic", str(path),
    )
    return path.read_bytes()


async def test_a_file_whose_only_picture_is_cover_art_is_refused(client, auth_headers, tmp_path):
    response = await client.post(
        "/api/videos",
        files={"file": ("song.mp4", _cover_only(tmp_path), "video/mp4")},
        headers=auth_headers,
    )

    assert response.status_code == 415
    assert response.json()["detail"] == (
        "This file has only a still cover image, not a video. Upload the video itself."
    )
    listing = await client.get("/api/videos", headers=auth_headers)
    assert listing.json()["total"] == 0


async def test_a_video_with_cover_art_uploads_with_its_own_thumbnail(client, auth_headers, tmp_path):
    path = tmp_path / "with-cover.mp4"
    _ffmpeg(
        *VIDEO, *AUDIO, "-i", str(_cover(tmp_path)),
        "-map", "0", "-map", "1", "-map", "2",
        "-c:v:0", "libx264", "-c:a", "aac", "-c:v:1", "png", "-disposition:v:1", "attached_pic",
        str(path),  # no -shortest: the one-frame cover would cut the file to 40 ms
    )

    response = await client.post(
        "/api/videos",
        files={"file": ("with-cover.mp4", path.read_bytes(), "video/mp4")},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert response.json()["has_thumbnail"] is True
    assert 1500 <= response.json()["duration_ms"] <= 2500
