"""Export: sidecar formats, the burn-in render, and download links."""

import json
import subprocess

import pytest

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.caption_style import Alignment, CaptionStyle, VerticalPosition
from app.models.export import ExportStatus
from app.services import subtitles
from tests.conftest import a_style


async def make_video(client, headers, sample_video_bytes) -> int:
    response = await client.post(
        "/api/videos",
        headers=headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
    )
    return response.json()["id"]


async def seed_captions(video_id: int) -> list[int]:
    async with AsyncSessionLocal() as session:
        rows = [
            Caption(
                video_id=video_id,
                sequence=i,
                start_ms=i * 400,
                end_ms=(i + 1) * 400,
                text=text,
                confidence=-0.4,
            )
            for i, text in enumerate(["the quick brown", "fox jumps over"])
        ]
        session.add_all(rows)
        await session.commit()
        return [row.id for row in rows]


@pytest.fixture
async def exportable(client, auth_headers, sample_video_bytes):
    video_id = await make_video(client, auth_headers, sample_video_bytes)
    await seed_captions(video_id)
    return video_id


def a_caption(**overrides) -> Caption:
    base = dict(
        video_id=1, sequence=0, start_ms=0, end_ms=1500, text="hello world",
        confidence=-0.3, override_color=None, override_bold=None, override_scale=None,
    )
    return Caption(**{**base, **overrides})


# ── Timestamps ───────────────────────────────────────────────────────────


def test_srt_and_vtt_differ_only_in_the_decimal_separator():
    """SRT uses a comma. A full stop there makes some players skip the cue."""
    assert subtitles.srt_time(3_723_456) == "01:02:03,456"
    assert subtitles.vtt_time(3_723_456) == "01:02:03.456"


def test_ass_time_is_centiseconds():
    """
    ASS is H:MM:SS.cc, not milliseconds.

    Writing three digits parses fine and shifts every caption, which is the
    kind of bug that looks like bad transcription rather than bad formatting.
    """
    assert subtitles.ass_time(3_723_456) == "1:02:03.45"
    assert subtitles.ass_time(0) == "0:00:00.00"
    assert subtitles.ass_time(1_500) == "0:00:01.50"


# ── Sidecar formats ──────────────────────────────────────────────────────


def test_srt_numbers_from_one_and_stays_contiguous():
    """
    `sequence` is 0-based and can be renumbered by edits; SRT indices must be
    1-based and gapless, because players stop at the first gap.
    """
    captions = [a_caption(sequence=5, text="first"), a_caption(sequence=9, text="second")]

    output = subtitles.to_srt(captions)

    assert output.startswith("1\n")
    assert "\n2\n" in output
    assert "5" not in output.splitlines()[0]


def test_vtt_has_the_mandatory_header():
    """Browsers reject a WebVTT file with no WEBVTT line."""
    assert subtitles.to_vtt([a_caption()]).startswith("WEBVTT\n\n")


def test_json_keeps_milliseconds_as_integers():
    """Float seconds would reintroduce exactly the comparison problems that
    integer milliseconds exist to avoid."""
    payload = json.loads(subtitles.to_json([a_caption(start_ms=1500, end_ms=3200)]))

    entry = payload["captions"][0]
    assert entry["start_ms"] == 1500 and isinstance(entry["start_ms"], int)
    assert entry["end_ms"] == 3200
    assert entry["emphasis"] is None


def test_json_reports_emphasis():
    payload = json.loads(
        subtitles.to_json([a_caption(override_bold=True, override_color="#FFD400")])
    )
    assert payload["captions"][0]["emphasis"]["bold"] is True


# ── ASS text safety ──────────────────────────────────────────────────────


def test_braces_cannot_smuggle_override_tags():
    """
    `{` opens an override block. A caption containing one would have part of
    itself eaten as formatting — or interpreted.
    """
    escaped = subtitles.escape_ass_text("use {\\b1} for bold")

    assert "{" not in escaped and "}" not in escaped
    assert "(" in escaped


def test_newlines_become_hard_breaks():
    """A raw newline would end the Dialogue line and orphan the rest."""
    assert subtitles.escape_ass_text("two\nlines") == "two\\Nlines"
    assert "\n" not in subtitles.escape_ass_text("crlf\r\nhere")


def test_inline_colour_differs_from_style_colour():
    """
    The two ASS colour forms are not interchangeable: a style carries an alpha
    byte, an inline \\c tag does not and ends with an ampersand. Swapping them
    parses cleanly and renders the wrong colour.
    """
    from app.services.caption_style import to_ass_colour, to_ass_inline_colour

    assert to_ass_colour("#FFCC00") == "&H0000CCFF"
    assert to_ass_inline_colour("#FFCC00") == "&H00CCFF&"


def test_emphasis_produces_inline_tags():
    document = subtitles.to_ass(
        [a_caption(override_bold=True, override_color="#FFD400", override_scale=1.5)],
        a_style(),
        1280,
        720,
    )

    dialogue = [line for line in document.splitlines() if line.startswith("Dialogue:")][0]
    assert "\\b1" in dialogue
    assert "\\c&H00D4FF&" in dialogue
    assert "\\fs" in dialogue


def test_uppercase_transforms_the_burned_text_and_nothing_else():
    """
    ASS has no property for letter case, so `uppercase` is the one style field
    applied to the text instead of to the Style line.

    Which makes the second half of this test the important half: the sidecars
    are the caption *content* and must keep the case they were transcribed in.
    Upper-casing an SRT would quietly rewrite the user's transcript because
    they wanted their burned-in captions to look shouty.
    """
    caption = a_caption(text="hello there")

    shouted = subtitles.to_ass([caption], a_style(uppercase=True), 1280, 720)
    normal = subtitles.to_ass([caption], a_style(uppercase=False), 1280, 720)

    assert "HELLO THERE" in shouted
    assert "hello there" not in shouted
    assert "hello there" in normal

    assert "hello there" in subtitles.to_srt([caption])
    assert "hello there" in subtitles.to_vtt([caption])


def test_ass_canvas_matches_the_frame():
    """
    libass scales everything it draws to PlayResX/Y. If that disagrees with the
    real frame size the export stops matching the preview, which is the one
    thing the styling milestone exists to prevent.
    """
    document = subtitles.to_ass([a_caption()], a_style(), 1920, 1080)

    assert "PlayResX: 1920" in document
    assert "PlayResY: 1080" in document


# ── Routes ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("fmt", ["srt", "vtt", "json"])
async def test_sidecar_export_completes_immediately(client, auth_headers, exportable, fmt):
    """No polling: formatting a transcript is milliseconds, so it is done inline."""
    response = await client.post(
        f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": fmt}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["progress"] == 100
    assert body["size_bytes"] > 0


@pytest.mark.asyncio
async def test_exporting_without_captions_is_refused(
    client, auth_headers, sample_video_bytes
):
    video_id = await make_video(client, auth_headers, sample_video_bytes)

    response = await client.post(
        f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": "srt"}
    )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_download_round_trip(client, auth_headers, exportable):
    created = await client.post(
        f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "srt"}
    )
    export_id = created.json()["id"]

    ticket = await client.post(
        f"/api/exports/{export_id}/download-token", headers=auth_headers
    )
    assert ticket.status_code == 200
    token = ticket.json()["token"]

    downloaded = await client.get(f"/api/exports/{export_id}/download?token={token}")

    assert downloaded.status_code == 200
    assert downloaded.headers["content-disposition"].startswith("attachment")
    assert "clip.srt" in downloaded.headers["content-disposition"]
    body = downloaded.text
    assert body.startswith("1\n")
    assert "the quick brown" in body


@pytest.mark.asyncio
async def test_download_rejects_a_token_for_another_export(
    client, auth_headers, exportable
):
    """A leaked link must not open the rest of the library."""
    first = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "srt"}
        )
    ).json()["id"]
    second = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "vtt"}
        )
    ).json()["id"]

    token = (
        await client.post(f"/api/exports/{first}/download-token", headers=auth_headers)
    ).json()["token"]

    response = await client.get(f"/api/exports/{second}/download?token={token}")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_download_rejects_an_access_token(client, auth_headers, exportable):
    export_id = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "srt"}
        )
    ).json()["id"]
    access = auth_headers["Authorization"].removeprefix("Bearer ")

    response = await client.get(f"/api/exports/{export_id}/download?token={access}")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_another_user_cannot_reach_your_exports(
    client, auth_headers, second_user_headers, exportable
):
    export_id = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "srt"}
        )
    ).json()["id"]

    for method, path, kwargs in [
        ("get", f"/api/videos/{exportable}/exports", {}),
        ("get", f"/api/exports/{export_id}", {}),
        ("post", f"/api/exports/{export_id}/download-token", {}),
        ("delete", f"/api/exports/{export_id}", {}),
        ("post", f"/api/videos/{exportable}/exports", {"json": {"format": "srt"}}),
    ]:
        response = await getattr(client, method)(path, headers=second_user_headers, **kwargs)
        assert response.status_code == 404, f"{method} {path}"


@pytest.mark.asyncio
async def test_delete_removes_the_row_and_the_file(client, auth_headers, exportable):
    """Checks this export's own file, not a glob — other tests leave their own."""
    from app.models.export import Export
    from app.services import storage

    created = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "srt"}
        )
    ).json()

    async with AsyncSessionLocal() as session:
        path = storage.resolve((await session.get(Export, created["id"])).storage_path)
    assert path.exists()

    assert (
        await client.delete(f"/api/exports/{created['id']}", headers=auth_headers)
    ).status_code == 204

    assert not path.exists()

    response = await client.get(f"/api/exports/{created['id']}", headers=auth_headers)
    assert response.status_code == 404


# ── The burn ─────────────────────────────────────────────────────────────


def _brightest_pixel(path, at_seconds: float) -> int:
    """
    The lightest pixel in one frame, 0-255.

    Raw greyscale straight out of FFmpeg rather than an image library: no extra
    dependency, and nothing to misinterpret. On a black source, anything above
    a few counts is something that was drawn on top.
    """
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-ss", str(at_seconds), "-i", str(path),
            "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
        ],
        capture_output=True,
        timeout=120,
    ).stdout
    return max(raw) if raw else 0


def _probe(path) -> dict:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,width,height",
            "-of", "json", str(path),
        ],
        capture_output=True,
        timeout=120,
    ).stdout
    return json.loads(out)


@pytest.mark.asyncio
async def test_burned_output_keeps_the_audio_and_the_resolution(
    client, auth_headers, exportable, tmp_path
):
    """
    The milestone's other promise, and the one the user actually asked for.

    Burning captions in means re-encoding the *video* — the pixels change, so
    there is no way around it. The audio has no such excuse and is copied
    through untouched, and the frame size must come out identical.
    """
    from app.services import storage
    from app.workers.export import _run

    async with AsyncSessionLocal() as session:
        from sqlalchemy import select

        from app.models.video import Video

        video = (
            await session.execute(select(Video).where(Video.id == exportable))
        ).scalar_one()
        source = storage.resolve(video.storage_path)

    created = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "mp4"}
        )
    ).json()
    assert created["status"] == "pending"

    # Run the task body directly rather than through the broker, so the test
    # doesn't depend on a worker being up.
    result = await _run(created["id"])
    assert "error" not in result, result

    response = await client.get(f"/api/exports/{created['id']}", headers=auth_headers)
    assert response.json()["status"] == "completed"

    async with AsyncSessionLocal() as session:
        from app.models.export import Export

        rendered = storage.resolve((await session.get(Export, created["id"])).storage_path)

    before, after = _probe(source), _probe(rendered)

    def stream(probe, kind):
        return next(s for s in probe["streams"] if s["codec_type"] == kind)

    # Audio: copied, so the codec is unchanged.
    assert stream(after, "audio")["codec_name"] == stream(before, "audio")["codec_name"]
    # Video: re-encoded, but at exactly the source's resolution.
    assert stream(after, "video")["width"] == stream(before, "video")["width"]
    assert stream(after, "video")["height"] == stream(before, "video")["height"]


@pytest.mark.asyncio
async def test_captions_are_actually_drawn_into_the_pixels(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """
    The test that would have caught a completely blank export.

    Checking codecs and dimensions says the render ran; it says nothing about
    whether libass drew anything. A malformed timestamp makes libass drop the
    event silently — FFmpeg still exits 0 and still writes a valid file, and
    every metadata assertion still passes.

    So this renders onto a **black** source and asserts the frame stops being
    black. On that background there is no ambiguity about what the light
    pixels are.
    """
    from sqlalchemy import select

    from app.models.export import Export
    from app.models.video import Video
    from app.services import storage
    from app.workers.export import _run

    video_id = await make_video(client, auth_headers, sample_video_bytes)
    await seed_captions(video_id)

    # Replace the stored file with a flat black clip that still has audio, so
    # the audio-copy assertions elsewhere stay meaningful.
    black = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=black:s=320x240:d=2:r=15",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(black),
        ],
        capture_output=True,
        timeout=120,
        check=True,
    )

    async with AsyncSessionLocal() as session:
        video = (
            await session.execute(select(Video).where(Video.id == video_id))
        ).scalar_one()
        source = storage.resolve(video.storage_path)
    source.write_bytes(black.read_bytes())

    assert _brightest_pixel(source, 0.2) < 40, "the control source is not actually black"

    created = (
        await client.post(
            f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": "mp4"}
        )
    ).json()
    assert "error" not in await _run(created["id"])

    async with AsyncSessionLocal() as session:
        rendered = storage.resolve((await session.get(Export, created["id"])).storage_path)

    # A caption covers 0-400ms, so this instant is inside one.
    assert _brightest_pixel(rendered, 0.2) > 200, (
        "the exported frame is still black — libass drew nothing"
    )


@pytest.mark.asyncio
async def test_render_fails_loudly_when_the_source_is_gone(
    client, auth_headers, exportable
):
    """A stuck 'processing' row is worse than an honest failure."""
    from app.services import storage
    from app.workers.export import _run

    async with AsyncSessionLocal() as session:
        from sqlalchemy import select

        from app.models.video import Video

        video = (
            await session.execute(select(Video).where(Video.id == exportable))
        ).scalar_one()
        storage.resolve(video.storage_path).unlink()

    created = (
        await client.post(
            f"/api/videos/{exportable}/exports", headers=auth_headers, json={"format": "mp4"}
        )
    ).json()

    await _run(created["id"])

    response = await client.get(f"/api/exports/{created['id']}", headers=auth_headers)
    assert response.json()["status"] == ExportStatus.FAILED.value
    assert "missing" in response.json()["error_message"]
