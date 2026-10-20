"""Export: sidecar formats, the burn-in render, and download links."""

import json
import subprocess

import pytest

from app.database import AsyncSessionLocal
from app.models.caption import Caption
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


def test_the_burn_is_not_named_after_the_source_video():
    """
    The two downloads must not land in a folder under the same name.

    A burn shares the source's extension, so naming it after the video gave
    "clip.mp4" for both the original and the captioned copy. The browser saves
    the second as "clip (1).mp4" without saying so, and opening the obvious one
    shows a video with no captions - the export was correct, it just was not
    the file that got opened.
    """
    from app.api.exports import download_filename
    from app.models.export import ExportFormat

    assert download_filename("clip", ExportFormat.MP4) == "clip-captions.mp4"


def test_sidecars_keep_the_video_name_exactly():
    """
    The opposite rule, and it is load-bearing: `clip.srt` beside `clip.mp4` is
    how every player finds a subtitle track on its own. A suffix here would be
    tidier and would break that.
    """
    from app.api.exports import download_filename
    from app.models.export import ExportFormat

    assert download_filename("clip", ExportFormat.SRT) == "clip.srt"
    assert download_filename("clip", ExportFormat.VTT) == "clip.vtt"
    assert download_filename("clip", ExportFormat.JSON) == "clip.json"


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


def _frame(path, at_seconds: float, width: int, height: int):
    """One decoded frame as a height x width greyscale array."""
    import numpy as np

    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-ss", str(at_seconds), "-i", str(path),
            "-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-",
        ],
        capture_output=True,
        timeout=120,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(height, width)


@pytest.mark.asyncio
async def test_burned_caption_sits_where_the_preview_puts_it(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """
    A hand-placed caption is burned at the point the editor showed it, and
    its box at the opacity the editor showed.

    The preview centres the caption's box on (pos_x, pos_y) of the frame
    (`translate(-50%, -50%)` at `left`/`top`), and draws the box at
    `box_opacity` over the video. So on a black source, a white box must be
    centred on that fraction of the frame, and its level relative to a fully
    opaque box must be `box_opacity` — measured from the rendered pixels, not
    from the ASS file that asked for them.
    """
    import numpy as np
    from sqlalchemy import select

    from app.models.export import Export
    from app.models.video import Video
    from app.services import storage
    from app.workers.export import _run

    width, height = 640, 360
    video_id = await make_video(client, auth_headers, sample_video_bytes)
    await seed_captions(video_id)
    black = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=2:r=15",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(black),
        ],
        capture_output=True, timeout=120, check=True,
    )
    async with AsyncSessionLocal() as session:
        video = (await session.execute(select(Video).where(Video.id == video_id))).scalar_one()
        storage.resolve(video.storage_path).write_bytes(black.read_bytes())

    placed = {
        "pos_x": 0.3, "pos_y": 0.25, "alignment": "center",
        "text_color": "#000000", "box_color": "#FFFFFF", "box_padding": 12,
        "outline_width": 0, "shadow": 0, "font_size": 60,
    }

    async def render(opacity: float):
        response = await client.patch(
            f"/api/videos/{video_id}/style", headers=auth_headers,
            json={**placed, "box_opacity": opacity},
        )
        assert response.status_code == 200, response.text
        created = (
            await client.post(
                f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": "mp4"}
            )
        ).json()
        assert "error" not in await _run(created["id"])
        async with AsyncSessionLocal() as session:
            path = storage.resolve((await session.get(Export, created["id"])).storage_path)
        # A caption covers 0-400 ms.
        return _frame(path, 0.2, width, height).astype(float)

    opaque, partial = await render(1.0), await render(0.6)
    background = float(np.median(opaque))  # most of the frame is untouched black

    # The box: everything clearly lighter than the background.
    box = opaque > background + 0.5 * (opaque.max() - background)
    rows, cols = np.where(box)
    assert rows.size > 0, f"no box was drawn (max {opaque.max()}, background {background}, partial max {partial.max()})"
    centre_x = (cols.min() + cols.max() + 1) / 2 / width
    centre_y = (rows.min() + rows.max() + 1) / 2 / height
    assert abs(centre_x - placed["pos_x"]) < 0.01, f"box centred at x={centre_x:.3f}"
    assert abs(centre_y - placed["pos_y"]) < 0.01, f"box centred at y={centre_y:.3f}"
    # One line is libass's whole cell — the font size — plus the padding above
    # and below. The preview's line-height is the font's win span in ems,
    # which is that same cell, so the two boxes are the same height.
    from app.services.caption_style import scale_for

    scale = scale_for(height)
    cell = round(placed["font_size"] * scale) + 2 * round(placed["box_padding"] * scale)
    box_height = rows.max() - rows.min() + 1
    assert abs(box_height - cell) <= 2, f"box {box_height}px tall, cell + padding is {cell}px"

    # Its level, on the box's own pixels (the black letters excluded).
    level_opaque = float(np.median(opaque[box])) - background
    level_partial = float(np.median(partial[box])) - background
    assert abs(level_partial / level_opaque - 0.6) < 0.03, (
        f"box drawn at {level_partial / level_opaque:.3f} of opaque, asked for 0.6"
    )


def test_indic_scripts_are_shaped_in_the_burn(tmp_path):
    """
    "कि" is drawn with its vowel sign ि *before* the consonant, as Hindi and
    Marathi are read. That takes complex (HarfBuzz) shaping; libass's simple
    shaping draws the characters in memory order, ि after क, and in Bengali,
    Tamil and Malayalam splits two-part vowel signs around a dotted circle.

    The burn used FFmpeg's `subtitles` filter, which cannot ask libass for
    complex shaping, so every Indic caption ever exported came out like that.
    Measured on the rendered pixels: ि's hook is the only ink above the
    headline, so it must sit in the left half of the word.
    """
    import numpy as np

    from app.services import rendering

    width, height = 640, 360
    source = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=1:r=5",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(source),
        ],
        capture_output=True, timeout=120, check=True,
    )
    style = a_style(font_key="sans", font_size=400, outline_width=0, shadow=0, box_opacity=0.0)
    caption = Caption(video_id=1, sequence=0, start_ms=0, end_ms=1000, text="कि", confidence=-0.1)
    ass = tmp_path / "captions.ass"
    ass.write_text(subtitles.to_ass([caption], style, width, height), encoding="utf-8")
    burned = tmp_path / "burned.mp4"
    rendering.burn_captions(source, ass, burned, duration_ms=1000)

    ink = _frame(burned, 0.5, width, height) > 128
    rows, cols = np.where(ink)
    assert rows.size > 0, "nothing was drawn"
    top, bottom = rows.min(), rows.max()
    left, right = cols.min(), cols.max()
    # The topmost ink: ि's hook, which rises above the headline.
    hook = cols[rows < top + (bottom - top) * 0.12]
    assert hook.mean() < (left + right) / 2, (
        "ि is drawn after क: the burn is not using complex shaping"
    )


def test_the_burn_asks_libass_for_complex_shaping():
    from pathlib import Path

    from app.services import rendering

    assert ":shaping=complex" in rendering._filter_chain(Path("/tmp/x.ass"), None)


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


# ── Output resolution ────────────────────────────────────────────────────


def test_target_dimensions_keeps_the_aspect_and_stays_even():
    """
    The width follows the source's shape rather than being asked for, so an
    export can never come out stretched, and both sides are even because
    yuv420p subsamples chroma by two and encoders reject odd sizes outright.
    """
    from app.services import rendering

    assert rendering.target_dimensions(256, 144, 1080) == (1920, 1080)
    assert rendering.target_dimensions(1920, 1080, 720) == (1280, 720)
    # Portrait, and a height whose exact width lands on an odd number.
    width, height = rendering.target_dimensions(1080, 1920, 721)
    assert width % 2 == 0 and height % 2 == 0


def test_no_requested_height_means_the_source_size():
    """The default, and the only choice that cannot soften the picture."""
    from app.services import rendering

    assert rendering.target_dimensions(640, 360, None) == (640, 360)


def test_requested_height_is_capped():
    """User input reaching an encoder; 100000 is a file nobody can play."""
    from app.services import rendering

    _, height = rendering.target_dimensions(1920, 1080, 99999)
    assert height == rendering.MAX_OUTPUT_HEIGHT


def test_available_heights_include_the_source_and_upscales():
    """
    Upscaling is offered on purpose. It adds no picture detail, but captions
    are drawn after the scale, so a 144p source rendered at 1080p turns an
    illegible 6px caption into a 45px one.
    """
    from app.services import rendering

    heights = rendering.available_heights(144)
    assert 144 in heights, "the source's own size must always be offered"
    assert 1080 in heights
    assert heights == sorted(heights)
    assert all(h <= rendering.MAX_OUTPUT_HEIGHT for h in heights)


def test_the_scale_runs_before_the_subtitles_filter():
    """
    The ordering *is* the feature.

    libass draws glyphs at whatever size the frames are when it runs. Scale
    first and the captions are rendered at the output size, sharp; scale second
    and they are drawn tiny and then stretched with the picture, which is
    indistinguishable from not offering the option at all.
    """
    from pathlib import Path

    from app.services import rendering

    chain = rendering._filter_chain(Path("/tmp/x.ass"), (1920, 1080))

    assert chain.index("scale=1920:1080") < chain.index("ass=")


def test_no_scale_filter_when_rendering_at_the_source_size():
    """An identity scale would resample the picture for nothing."""
    from pathlib import Path

    from app.services import rendering

    assert "scale=" not in rendering._filter_chain(Path("/tmp/x.ass"), None)


@pytest.mark.asyncio
async def test_requested_height_is_stored_on_the_burn(
    client, auth_headers, exportable
):
    created = (
        await client.post(
            f"/api/videos/{exportable}/exports",
            headers=auth_headers,
            json={"format": "mp4", "height": 720},
        )
    ).json()

    assert created["height"] == 720


@pytest.mark.asyncio
async def test_a_height_on_a_sidecar_is_ignored_not_rejected(
    client, auth_headers, exportable
):
    """
    A text file has no frame size. The panel has one resolution control for the
    whole section, so it should not have to remember which formats it applies
    to - dropping the value is friendlier than a 422 the user cannot act on.
    """
    created = (
        await client.post(
            f"/api/videos/{exportable}/exports",
            headers=auth_headers,
            json={"format": "srt", "height": 720},
        )
    ).json()

    assert created["height"] is None
    assert created["status"] == "completed"


@pytest.mark.asyncio
async def test_an_absurd_height_is_rejected(client, auth_headers, exportable):
    response = await client.post(
        f"/api/videos/{exportable}/exports",
        headers=auth_headers,
        json={"format": "mp4", "height": 99999},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_options_report_the_ladder_and_the_encoder(
    client, auth_headers, exportable
):
    response = await client.get(
        f"/api/videos/{exportable}/exports/options", headers=auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["resolutions"], "the picker would be empty"
    # Whatever the source is, exactly one offer is its own size.
    assert sum(1 for r in body["resolutions"] if r["native"]) <= 1
    for resolution in body["resolutions"]:
        assert resolution["label"] == f"{resolution['height']}p"
        if body["source_height"]:
            assert resolution["upscaled"] == (resolution["height"] > body["source_height"])


def test_the_default_height_rescues_an_unreadable_caption():
    """
    The default is not the source's own size, and that is the point.

    Caption sizes are stored against a 1080p canvas and scaled by
    height/1080, so a 256x144 source renders a 48px caption at 6px. Defaulting
    to the source would mean the obvious button produces a file whose captions
    cannot be read - which is the one thing a captioning tool must not do.
    """
    from app.services import rendering

    default = rendering.recommended_height(144, font_size=48, reference_height=1080)

    assert default > 144, "a 6px caption is not an acceptable default"
    assert 48 * default / 1080 >= rendering.MIN_CAPTION_PX


def test_a_big_enough_source_keeps_its_own_size():
    """The common case, and it must not be resampled for no reason."""
    from app.services import rendering

    assert rendering.recommended_height(1080, font_size=48, reference_height=1080) == 1080
    assert rendering.recommended_height(2160, font_size=48, reference_height=1080) == 2160


def test_the_default_never_downscales():
    """
    Upscaling to rescue legibility is a fair trade; throwing away detail the
    source actually has is not, and must never happen without being asked.
    """
    from app.services import rendering

    for source in (360, 480, 720, 1080, 1440, 2160):
        assert rendering.recommended_height(source, 48, 1080) >= source


def test_a_larger_caption_needs_less_upscaling():
    """The recommendation follows the style, not just the source."""
    from app.services import rendering

    assert rendering.recommended_height(144, font_size=90, reference_height=1080) <= (
        rendering.recommended_height(144, font_size=48, reference_height=1080)
    )


@pytest.mark.asyncio
async def test_deleting_the_video_deletes_its_export_files(client, auth_headers, exportable):
    """The rows cascade in Postgres; the files on disk must go with them."""
    from app.models.export import Export
    from app.services import storage

    paths = []
    for export_format in ("srt", "vtt"):
        created = (
            await client.post(
                f"/api/videos/{exportable}/exports",
                headers=auth_headers,
                json={"format": export_format},
            )
        ).json()
        async with AsyncSessionLocal() as session:
            paths.append(storage.resolve((await session.get(Export, created["id"])).storage_path))
    assert all(path.exists() for path in paths)

    assert (
        await client.delete(f"/api/videos/{exportable}", headers=auth_headers)
    ).status_code == 204

    assert not any(path.exists() for path in paths)


def test_indic_runs_get_their_own_font_at_the_caption_fonts_em():
    """
    Indic text is drawn in a vendored Noto face named for its script, sized so
    its em is the caption font's em — the em the browser draws it at — and
    the caption font comes back afterwards. Latin text is left alone, and so
    are the spaces between words: the browser draws a space in the caption
    font (the Noto faces are limited to their script), so the burn does too.
    """
    from app.services.caption_style import font_win_span, script_font_span

    style = a_style(font_key="poppins", bold=True, font_size=54)
    caption = Caption(
        video_id=1, sequence=0, start_ms=0, end_ms=1000,
        text="Hello हमारा सूप, এবং Tamil", confidence=-0.1,
    )
    line = subtitles.to_ass([caption], style, 1280, 720).splitlines()[-1]
    size = 54 * 720 / 1080
    devanagari = round(size * script_font_span("Noto Sans Devanagari", True) / font_win_span("poppins", True), 2)

    # The ASS tags fn and fs with their backslash, built rather than escaped.
    fn, fs = chr(92) + "fn", chr(92) + "fs"
    noto, back = f"{{{fn}Noto Sans Devanagari{fs}{devanagari:g}}}", f"{{{fn}Poppins{fs}{size:g}}}"
    assert f"Hello {noto}हमारा{back} {noto}सूप{back}," in line
    assert f"{{{fn}Noto Sans Bengali" in line
    assert line.endswith(f"}}এবং{back} Tamil")


def test_indic_text_is_burned_at_the_caption_fonts_em(tmp_path):
    """
    The same Hindi word under two caption fonts comes out in the ratio of
    their win spans: drawn in one Noto face at each font's own em, as the
    preview draws it. Before, libass sized whatever fallback it picked by the
    fallback's own span, so the caption font made no difference.
    """
    import numpy as np

    from app.services import rendering
    from app.services.caption_style import font_win_span

    width, height = 640, 360
    source = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=1:r=5",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(source),
        ],
        capture_output=True, timeout=120, check=True,
    )

    def ink_height(font_key: str) -> int:
        style = a_style(font_key=font_key, bold=True, font_size=300, outline_width=0, shadow=0, box_opacity=0.0)
        caption = Caption(video_id=1, sequence=0, start_ms=0, end_ms=1000, text="हमारा", confidence=-0.1)
        ass = tmp_path / f"{font_key}.ass"
        ass.write_text(subtitles.to_ass([caption], style, width, height), encoding="utf-8")
        burned = tmp_path / f"{font_key}.mp4"
        rendering.burn_captions(source, ass, burned, duration_ms=1000)
        rows = np.where((_frame(burned, 0.5, width, height) > 128).any(axis=1))[0]
        return rows.max() - rows.min() + 1

    expected = font_win_span("sans", True) / font_win_span("poppins", True)
    assert ink_height("poppins") / ink_height("sans") == pytest.approx(expected, abs=0.03)


def test_cyrillic_gets_noto_only_when_the_caption_font_has_none():
    """
    Russian in Poppins (the default, no Cyrillic) is drawn in Noto Sans at
    Poppins's em, as the preview draws it; in Lato, which has Cyrillic, Lato
    draws it and nothing is wrapped.
    """
    from app.services.caption_style import covers, script_fonts

    assert not covers("poppins", True, 0x0416)
    assert covers("lato", True, 0x0416)
    assert ("Noto Sans", "Ѐ-ԯ") in script_fonts("poppins", True)
    assert all(family != "Noto Sans" for family, _ in script_fonts("lato", True))

    def line(font_key: str) -> str:
        style = a_style(font_key=font_key, bold=True, font_size=54)
        caption = Caption(video_id=1, sequence=0, start_ms=0, end_ms=1000, text="Сначала два лука", confidence=-0.1)
        return subtitles.to_ass([caption], style, 1280, 720).splitlines()[-1]

    fn = chr(92) + "fn"
    assert f"{{{fn}Noto Sans" in line("poppins")
    assert line("lato").endswith("}Сначала два лука")
    assert fn not in line("lato")


def test_cyrillic_is_burned_at_the_caption_fonts_em(tmp_path):
    """
    The same Russian word under two caption fonts without Cyrillic comes out
    in the ratio of their win spans (Noto Sans at each one's em). Before, it
    was the same size under both: libass sized the fallback by its own span.
    """
    import numpy as np

    from app.services import rendering
    from app.services.caption_style import font_win_span

    width, height = 640, 360
    source = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=1:r=5",
            "-f", "lavfi", "-i", "sine=duration=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(source),
        ],
        capture_output=True, timeout=120, check=True,
    )

    def ink_height(font_key: str) -> int:
        style = a_style(font_key=font_key, bold=False, font_size=300, outline_width=0, shadow=0, box_opacity=0.0)
        caption = Caption(video_id=1, sequence=0, start_ms=0, end_ms=1000, text="Шуба", confidence=-0.1)
        ass = tmp_path / f"{font_key}.ass"
        ass.write_text(subtitles.to_ass([caption], style, width, height), encoding="utf-8")
        burned = tmp_path / f"{font_key}.mp4"
        rendering.burn_captions(source, ass, burned, duration_ms=1000)
        rows = np.where((_frame(burned, 0.5, width, height) > 128).any(axis=1))[0]
        return rows.max() - rows.min() + 1

    expected = font_win_span("bebas-neue", False) / font_win_span("poppins", False)
    assert ink_height("poppins") / ink_height("bebas-neue") == pytest.approx(expected, abs=0.03)


# ── Caption language and character encoding (v1.0.8) ───────────────────

LANGUAGE_CAPTIONS = {
    "en": ["First, chop two onions", "and fry them slowly."],
    "hi": ["सबसे पहले, दो प्याज़ काटें", "और उन्हें धीरे-धीरे भूनें।"],
    "mr": ["सर्वात आधी, दोन कांदे चिरा", "आणि ते हळूहळू परता."],
}


@pytest.mark.asyncio
async def test_every_export_holds_the_language_it_was_made_in(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """
    Three caption languages back to back (a Redo replaces the captions each
    time), every format exported in each. Each file holds that language,
    no two languages' files are the same, and each export says which language
    it holds and whether those are still the video's captions — an English
    SRT left in the list after a Redo into Hindi was downloaded as the Hindi
    one, because nothing told them apart.
    """
    import hashlib

    from sqlalchemy import delete

    from app.models.export import Export
    from app.models.video import Video
    from app.services import storage
    from app.workers.export import _run

    video_id = await make_video(client, auth_headers, sample_video_bytes)
    black = tmp_path / "black.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1:r=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(black)],
        capture_output=True, timeout=120, check=True,
    )
    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        storage.resolve(video.storage_path).write_bytes(black.read_bytes())

    made: dict[str, dict[str, int]] = {}
    for language, texts in LANGUAGE_CAPTIONS.items():
        async with AsyncSessionLocal() as session:
            await session.execute(delete(Caption).where(Caption.video_id == video_id))
            video = await session.get(Video, video_id)
            video.caption_language = language
            session.add_all([
                Caption(video_id=video_id, sequence=i, start_ms=i * 400, end_ms=(i + 1) * 400, text=t)
                for i, t in enumerate(texts)
            ])
            await session.commit()
        made[language] = {}
        for fmt in ("srt", "vtt", "json", "mp4"):
            created = (
                await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt})
            ).json()
            assert created["caption_language"] == language, created
            assert created["current"] is True, created
            if fmt == "mp4":
                assert "error" not in await _run(created["id"])
            made[language][fmt] = created["id"]

    async def body(export_id: int) -> bytes:
        async with AsyncSessionLocal() as session:
            return storage.resolve((await session.get(Export, export_id)).storage_path).read_bytes()

    listed = {
        item["id"]: item
        for item in (await client.get(f"/api/videos/{video_id}/exports", headers=auth_headers)).json()["items"]
    }
    for fmt in ("srt", "vtt", "json", "mp4"):
        digests = set()
        for language, texts in LANGUAGE_CAPTIONS.items():
            export_id = made[language][fmt]
            data = await body(export_id)
            digests.add(hashlib.sha256(data).hexdigest())
            if fmt != "mp4":
                text = data.decode("utf-8")
                assert texts[0].split()[0] in text and texts[1].split()[-1] in text, (fmt, language)
                for other, other_texts in LANGUAGE_CAPTIONS.items():
                    if other != language:
                        assert other_texts[0].split()[-1] not in text, (fmt, language, other)
            assert listed[export_id]["caption_language"] == language
            # Only the last language's exports are made from today's captions.
            assert listed[export_id]["current"] is (language == "mr"), (fmt, language)
        assert len(digests) == 3, f"{fmt}: two languages' files are identical"


def test_json_export_writes_real_characters():
    """Devanagari as itself in a UTF-8 file, not as backslash-u escapes; still valid JSON."""
    caption = Caption(start_ms=0, end_ms=1000, text="त्यामुळे व्हिडिओमध्ये", confidence=None)
    written = subtitles.to_json([caption])
    assert "त्यामुळे व्हिडिओमध्ये" in written
    assert r"\u0924" not in written
    assert json.loads(written)["captions"][0]["text"] == "त्यामुळे व्हिडिओमध्ये"


@pytest.mark.asyncio
async def test_a_retimed_caption_keeps_its_timing_through_reload_and_export(exportable, client, auth_headers):
    """
    Dragging a caption's edge in the editor is the last word on its timing:
    nothing re-times captions except a Redo, so it reads back and exports
    exactly as set.
    """
    video_id = exportable
    items = (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"]
    first = items[0]
    patched = await client.patch(
        f"/api/captions/{first['id']}", headers=auth_headers, json={"start_ms": 37, "end_ms": 391}
    )
    assert patched.status_code == 200, patched.text
    again = (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"][0]
    assert (again["start_ms"], again["end_ms"]) == (37, 391)
    for fmt, stamp in (("srt", "00:00:00,037 --> 00:00:00,391"), ("vtt", "00:00:00.037 --> 00:00:00.391")):
        created = (await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt})).json()
        ticket = (await client.post(f"/api/exports/{created['id']}/download-token", headers=auth_headers)).json()
        body = (await client.get(f"/api/exports/{created['id']}/download?token={ticket['token']}")).text
        assert stamp in body, (fmt, body[:120])


# ── Caption starts in every output (v1.0.9) ─────────────────────────────
#
# A caption appears no later than 100 ms after its stored start, no earlier
# than 200 ms before it: in SRT, VTT and the burned video, in Hindi, English
# and Spanish. Starts off the frame grid on purpose (24 fps, as the Hindi
# tutorial), since that is where rounding would show.
TIMED = [(1013, 1900, "और आपके कैप्शन"), (2371, 3100, "and drag your video"), (3555, 4300, "primero corta dos")]


def _timed_captions():
    return [a_caption(sequence=i, start_ms=s, end_ms=e, text=t) for i, (s, e, t) in enumerate(TIMED)]


def _cue_starts(text: str) -> list[int]:
    import re

    out = []
    for h, m, s, ms in re.findall(r"^(\d+):(\d\d):(\d\d)[,.](\d{3}) -->", text, re.M):
        out.append(((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms))
    return out


def test_srt_and_vtt_start_each_caption_at_its_stored_start():
    captions = _timed_captions()
    assert _cue_starts(subtitles.to_srt(captions)) == [s for s, _, _ in TIMED]
    assert _cue_starts(subtitles.to_vtt(captions)) == [s for s, _, _ in TIMED]


def test_the_burn_shows_each_caption_within_a_frame_of_its_start(tmp_path):
    import numpy as np

    from app.services import rendering

    width, height, fps = 320, 180, 24
    source = tmp_path / "black.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=5:r={fps}",
            "-f", "lavfi", "-i", "sine=duration=5",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            str(source),
        ],
        capture_output=True, timeout=120, check=True,
    )
    style = a_style(font_key="sans", font_size=60, box_opacity=0.0)
    ass = tmp_path / "captions.ass"
    ass.write_text(subtitles.to_ass(_timed_captions(), style, width, height), encoding="utf-8")
    burned = tmp_path / "burned.mp4"
    rendering.burn_captions(source, ass, burned, duration_ms=5000)

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(burned), "-pix_fmt", "gray", "-f", "rawvideo", "-"],
        capture_output=True, timeout=120, check=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width)
    inked = [bool((frame > 128).any()) for frame in frames]
    appeared = [i * 1000 / fps for i in range(1, len(inked)) if inked[i] and not inked[i - 1]]
    assert len(appeared) == len(TIMED), appeared
    for (start, _, text), at in zip(TIMED, appeared):
        assert -200 <= at - start <= 100, f"{text!r} appears {at - start:+.0f} ms from its start"
        # And on the first frame at or after it: nothing later than one frame.
        assert at - start < 1000 / fps
