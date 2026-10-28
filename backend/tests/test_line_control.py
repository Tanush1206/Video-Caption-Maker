"""
Caption line control (v1.0.8): manual line breaks, the Auto / Balanced /
Stacked line styles, and the fit rule — in the layout, in the burned pixels,
in SRT and VTT, and across a Redo.

The editor runs the same rule (frontend/src/lib/caption-layout.ts); the
browser half is checked by scripts/ui-check `line-styles` and
`layout-parity`.
"""

import json
import re
import subprocess
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.caption_style import CaptionStyle
from app.services import caption as caption_service
from app.services import rendering, storage, subtitles
from app.services.caption_layout import SAFE_AREA, layout_caption
from app.services.caption_style import default_style_fields
from tests.conftest import a_style

ENGLISH = (
    "Finally, stir everything together until the soup is completely smooth, then serve it "
    "hot with fresh bread, a little butter and a handful of chopped herbs"
)
HINDI = "अंत में, सब कुछ चिकना होने तक मिलाएँ और इसे ताज़ी रोटी के साथ परोसें"
RUSSIAN = "Наконец, перемешайте все, пока оно не будет гладким, и подайте его с хлебом"


def _style(**overrides):
    return a_style(
        **{
            "font_key": "poppins", "bold": True, "font_size": 54, "pos_x": 0.5, "pos_y": 0.5,
            "box_opacity": 0.0, "outline_width": 3, "shadow": 0, **overrides,
        }
    )


def _caption(text: str, i: int = 0) -> Caption:
    return Caption(
        video_id=1, sequence=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=text, confidence=-0.1
    )


def _burn(captions, style, width, height, tmp_path):
    """Every caption burned on a grey frame of its own, as rgb arrays."""
    ass = tmp_path / "lines.ass"
    ass.write_text(subtitles.to_ass(captions, style, width, height), encoding="utf-8")
    raw = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-f", "lavfi", "-i", f"color=c=0x808080:s={width}x{height}:r=1:d={len(captions)}",
            "-vf", rendering._filter_chain(ass, None),
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        capture_output=True, timeout=300, check=True,
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(len(captions), height, width, 3)


def _ink_rows(frame) -> list[tuple[int, int]]:
    """Bands of rows with ink in them: one per line of text."""
    rows = np.any(np.abs(frame.astype(int) - 128) > 40, axis=(1, 2))
    bands, start = [], None
    for y, inked in enumerate(rows):
        if inked and start is None:
            start = y
        elif not inked and start is not None:
            bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, len(rows)))
    return bands


# ── Manual line breaks ──────────────────────────────────────────────────


def test_a_manual_break_is_a_line_break():
    """Shift+Enter's newline ends a line there, whatever the width allows."""
    layout = layout_caption("Hello there\nmy friends", _style(), 1920, 1080)
    assert layout.text == ("Hello there", "my friends")


def test_a_manual_line_wider_than_the_box_also_wraps():
    """A manual line too wide for the box wraps inside itself; the break stays."""
    text = "Stir everything together until it is smooth and serve it warm\nthen eat"
    layout = layout_caption(text, _style(box_width=0.3, max_lines=6), 1920, 1080)
    assert len(layout.text) > 2
    assert layout.text[-1] == "then eat"
    assert " ".join(layout.text[:-1]).split() == text.split("\n")[0].split()


def test_a_manual_break_is_burned_where_it_was_put(tmp_path):
    """
    Two lines in the MP4, the break between "there" and "my": the ASS breaks
    there, and the frame has two bands of text, the second one narrower.
    """
    style = _style()
    doc = subtitles.to_ass([_caption("Hello there\nmy")], style, 1280, 720)
    assert "Hello there\\Nmy" in doc
    frame = _burn([_caption("Hello there\nmy")], style, 1280, 720, tmp_path)[0]
    bands = _ink_rows(frame)
    assert len(bands) == 2, bands


@pytest.mark.parametrize("fmt", ["srt", "vtt"])
@pytest.mark.asyncio
async def test_srt_and_vtt_break_where_the_burn_does(fmt, client, auth_headers, sample_video_bytes, tmp_path):
    """
    A manual break is a real line break in the sidecar, and so is every line
    the burn wraps: the sidecar's lines are the burn's, on the video's frame.
    """
    from app.models.video import Video

    width, height = 640, 360
    video_id = (
        await client.post(
            "/api/videos", headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
    ).json()["id"]
    source = tmp_path / "black.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=1:r=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)],
        capture_output=True, timeout=120, check=True,
    )
    texts = ["Hello there\nmy friends", ENGLISH]
    async with AsyncSessionLocal() as session:
        video = (await session.execute(select(Video).where(Video.id == video_id))).scalar_one()
        storage.resolve(video.storage_path).write_bytes(source.read_bytes())
        session.add_all([
            Caption(video_id=video_id, sequence=i, start_ms=i * 2000, end_ms=i * 2000 + 1500, text=t)
            for i, t in enumerate(texts)
        ])
        await session.commit()
    await client.patch(f"/api/videos/{video_id}/style", headers=auth_headers, json={"uppercase": True})

    created = (
        await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt})
    ).json()
    ticket = (await client.post(f"/api/exports/{created['id']}/download-token", headers=auth_headers)).json()
    body = (await client.get(f"/api/exports/{created['id']}/download?token={ticket['token']}")).text

    async with AsyncSessionLocal() as session:
        style = (await session.execute(select(CaptionStyle).where(CaptionStyle.video_id == video_id))).scalar_one()
        burned = [layout_caption(t, style, width, height).text for t in texts]
    assert "Hello there\nmy friends\n" in body
    assert len(burned[1]) > 1
    # In the burn's lines, in the words' own case (the burn is upper-cased).
    assert "\n".join(line.title() for line in burned[1]).lower() in body.lower()
    assert "\n".join(burned[1]) not in body


def _sidecar_lines(body: str, fmt: str) -> list[list[str]]:
    """Each cue's text lines, in order: everything after its timing line."""
    if fmt == "vtt":
        body = body.removeprefix("WEBVTT\n\n")
    cues = []
    for block in body.strip("\n").split("\n\n"):
        lines = block.split("\n")
        timing = next(i for i, line in enumerate(lines) if " --> " in line)
        cues.append(lines[timing + 1:])
    return cues


def _burned_lines(document: str) -> list[list[str]]:
    """Each caption's lines as the burn draws them: its text event, tags removed."""
    # Fields: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text.
    return [
        re.sub(r"\{[^}]*\}", "", line.split(",", 9)[9]).split("\\N")
        for line in document.splitlines()
        if line.startswith("Dialogue: 1,")
    ]


@pytest.mark.asyncio
async def test_srt_and_vtt_follow_the_line_style_at_export_time(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """
    For each line style, changed just before exporting: every SRT and VTT cue
    has exactly the lines the burn draws for that caption, on the video's
    frame. Stacked with 3 words a line is the case from 1.1.1's testing.
    """
    from app.models.video import Video

    width, height = 1280, 720
    video_id = (
        await client.post(
            "/api/videos", headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
    ).json()["id"]
    source = tmp_path / "black.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}:d=1:r=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)],
        capture_output=True, timeout=120, check=True,
    )
    texts = [
        "ko auto generate karegi aur",
        "Hello there\nmy friends, and a few more words",
        ENGLISH,
        HINDI,
        "short",
    ]
    async with AsyncSessionLocal() as session:
        video = (await session.execute(select(Video).where(Video.id == video_id))).scalar_one()
        storage.resolve(video.storage_path).write_bytes(source.read_bytes())
        session.add_all([
            Caption(video_id=video_id, sequence=i, start_ms=i * 2000, end_ms=i * 2000 + 1500, text=t)
            for i, t in enumerate(texts)
        ])
        await session.commit()

    looks = [
        {"line_style": "stacked", "words_per_line": 3, "max_lines": 4},
        {"line_style": "balanced", "max_lines": 2},
        {"line_style": "auto", "max_lines": 3, "box_width": 0.5},
        {"line_style": "stacked", "words_per_line": 1, "max_lines": 6},
        {"line_style": "balanced", "max_lines": 1, "box_width": 0.3},
    ]
    for look in looks:
        saved = await client.patch(f"/api/videos/{video_id}/style", headers=auth_headers, json=look)
        assert saved.status_code == 200
        async with AsyncSessionLocal() as session:
            style = (
                await session.execute(select(CaptionStyle).where(CaptionStyle.video_id == video_id))
            ).scalar_one()
            burned = _burned_lines(subtitles.to_ass(
                [Caption(video_id=video_id, sequence=i, start_ms=i * 2000, end_ms=i * 2000 + 1500, text=t)
                 for i, t in enumerate(texts)],
                style, width, height,
            ))
        assert any(len(lines) > 1 for lines in burned), look
        for fmt in ("srt", "vtt"):
            created = (
                await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt})
            ).json()
            ticket = (
                await client.post(f"/api/exports/{created['id']}/download-token", headers=auth_headers)
            ).json()
            body = (await client.get(f"/api/exports/{created['id']}/download?token={ticket['token']}")).text
            assert _sidecar_lines(body, fmt) == burned, (look, fmt)
    # The 1.1.1 report: Stacked, 3 words a line, gives two lines.
    stacked = _burned_lines(subtitles.to_ass(
        [Caption(video_id=1, sequence=0, start_ms=0, end_ms=1500, text=texts[0])],
        _style(line_style="stacked", words_per_line=3, max_lines=4), width, height,
    ))
    assert stacked == [["ko auto generate", "karegi aur"]]


@pytest.mark.asyncio
async def test_a_manual_break_is_saved(client, auth_headers, sample_video_bytes):
    """Stored as the newline it is, and read back the same: it survives a reload."""
    video_id = (
        await client.post(
            "/api/videos", headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
    ).json()["id"]
    async with AsyncSessionLocal() as session:
        session.add(Caption(video_id=video_id, sequence=0, start_ms=0, end_ms=1000, text="one two"))
        await session.commit()
    caption_id = (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"][0]["id"]
    await client.patch(f"/api/captions/{caption_id}", headers=auth_headers, json={"text": "one\ntwo"})
    items = (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"]
    assert items[0]["text"] == "one\ntwo"


# ── Redo ────────────────────────────────────────────────────────────────


def test_breaks_are_put_back_on_exactly_the_same_words():
    saved = caption_service.saved_breaks([_caption("Hello there\nmy friends"), _caption("no break")])
    assert caption_service.restore_breaks("Hello there my friends", saved) == "Hello there\nmy friends"
    assert caption_service.restore_breaks("Hello there my friend", saved) == "Hello there my friend"
    assert caption_service.restore_breaks("no break", saved) == "no break"


@pytest.mark.parametrize(
    ("payload", "kept"),
    [(None, True), ({"spoken_language": "en"}, True), ({"caption_language": "same"}, True),
     ({"caption_language": "hi"}, False)],
)
@pytest.mark.asyncio
async def test_redo_keeps_breaks_only_in_the_same_caption_language(
    payload, kept, client, auth_headers, sample_video_bytes, monkeypatch
):
    seen = {}
    monkeypatch.setattr(
        "app.api.videos._enqueue_transcription",
        lambda video_id, keep_breaks=False: seen.update(keep=keep_breaks) or True,
    )
    video_id = (
        await client.post(
            "/api/videos", headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
    ).json()["id"]
    await _set_completed(video_id)
    kwargs = {"json": payload} if payload is not None else {}
    response = await client.post(f"/api/videos/{video_id}/transcribe", headers=auth_headers, **kwargs)
    assert response.status_code == 200, response.text
    assert seen["keep"] is kept


async def _set_completed(video_id: int) -> None:
    from app.models.video import Video, VideoStatus

    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        video.status = VideoStatus.COMPLETED
        await session.commit()


@pytest.mark.parametrize("keep", [True, False])
@pytest.mark.asyncio
async def test_a_redo_restores_breaks_on_matching_captions(
    keep, client, auth_headers, sample_video_bytes, monkeypatch
):
    """
    The job, with speech recognition faked: a caption that comes back with
    the same words gets its break back when asked to keep them, and only then.
    """
    from app.models.video import Video
    from app.services import embeddings, transcription
    from app.workers import transcription as job

    video_id = (
        await client.post(
            "/api/videos", headers=auth_headers,
            files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        )
    ).json()["id"]
    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        video.spoken_language, video.caption_language = "en", "same"
        session.add_all([
            Caption(video_id=video_id, sequence=0, start_ms=0, end_ms=900, text="Hello there\nmy friends."),
            Caption(video_id=video_id, sequence=1, start_ms=1000, end_ms=1900, text="Stir it\nwell."),
        ])
        await session.commit()

    segments = [
        SimpleNamespace(start_ms=0, end_ms=900, text="Hello there my friends.", confidence=-0.1),
        SimpleNamespace(start_ms=1000, end_ms=1900, text="Stir it slowly.", confidence=-0.1),
    ]
    monkeypatch.setattr(transcription, "load_model", lambda *a, **k: None)
    monkeypatch.setattr(transcription, "extract_audio", lambda source, dest: Path(dest).write_bytes(b""))
    monkeypatch.setattr(transcription, "transcribe", lambda *a, **k: (segments, "en"))
    monkeypatch.setattr(embeddings, "delete_video_vectors", lambda *a: None)
    monkeypatch.setattr(embeddings, "index_captions", lambda *a: None)

    await job._run(video_id, keep_breaks=keep)

    async with AsyncSessionLocal() as session:
        texts = list(
            (await session.execute(
                select(Caption.text).where(Caption.video_id == video_id).order_by(Caption.sequence)
            )).scalars()
        )
    first = "Hello there\nmy friends." if keep else "Hello there my friends."
    assert texts == [first, "Stir it slowly."]


# ── Line styles ─────────────────────────────────────────────────────────


def _widths(layout) -> list[float]:
    return [line.width for line in layout.lines]


@pytest.mark.parametrize("box_width", [0.3, 0.4, 0.55])
def test_balanced_keeps_autos_line_count_and_evens_the_lines(box_width):
    """
    Auto fills each line to the box width, so its last line is often short;
    Balanced has the same number of lines, evened out so they differ by less
    than one word: the spread between the longest and shortest line is no
    more than Auto's and less than the widest word.
    """
    texts = [ENGLISH, HINDI, RUSSIAN, "One two three four five six seven eight nine ten eleven twelve"]
    improved = False
    for text in texts:
        auto = layout_caption(text, _style(box_width=box_width, max_lines=6, line_style="auto"), 1920, 1080)
        balanced = layout_caption(text, _style(box_width=box_width, max_lines=6, line_style="balanced"), 1920, 1080)
        assert len(balanced.lines) == len(auto.lines), text
        assert " ".join(balanced.text).split() == text.split()
        if len(auto.lines) < 2:
            continue
        spread_auto = max(_widths(auto)) - min(_widths(auto))
        spread_balanced = max(_widths(balanced)) - min(_widths(balanced))
        widest_word = max(
            layout_caption(w, _style(box_width=box_width), 1920, 1080).lines[0].width for w in text.split()
        )
        assert spread_balanced <= spread_auto + 1e-6, text
        assert spread_balanced < widest_word, (text, spread_balanced, widest_word)
        improved |= spread_balanced < spread_auto - 1
    assert improved, "Balanced never evened out a line Auto left ragged"


def test_auto_fills_each_line_to_the_box():
    """Every line but the last is as full as it can be: the next word won't fit."""
    style = _style(box_width=0.4, max_lines=6, line_style="auto")
    layout = layout_caption(ENGLISH, style, 1920, 1080)
    words = ENGLISH.split()
    assert len(layout.lines) > 2
    for line, nxt in zip(layout.text, layout.text[1:]):
        longer = line + " " + nxt.split()[0]
        wider = layout_caption(longer, _style(box_width=0.94, line_style="auto"), 1920, 1080).lines[0].width
        assert wider > 0.4 * 1920 - 2 * layout.pad, (line, nxt)
    assert " ".join(layout.text).split() == words


@pytest.mark.parametrize("words_per_line", [1, 2, 3, 4])
@pytest.mark.parametrize("text", [ENGLISH, HINDI, RUSSIAN], ids=["en", "hi", "ru"])
def test_stacked_puts_n_words_on_a_line(words_per_line, text):
    """N words a line, the last line the rest, whatever the box width allows."""
    style = _style(line_style="stacked", words_per_line=words_per_line, max_lines=6, box_width=0.94)
    layout = layout_caption(text, style, 1920, 1080)
    words = text.split()
    expected = [" ".join(words[i:i + words_per_line]) for i in range(0, len(words), words_per_line)]
    assert list(layout.text) == expected


def test_stacked_wraps_a_group_too_wide_for_the_box():
    style = _style(line_style="stacked", words_per_line=4, box_width=0.2, font_size=80)
    layout = layout_caption("Rindfleischetikettierung and something else here", style, 1920, 1080)
    assert all(line.width <= 0.2 * 1920 for line in layout.lines)
    assert " ".join(layout.text).split() == "Rindfleischetikettierung and something else here".split() or (
        "".join(layout.text).replace(" ", "") == "Rindfleischetikettierungandsomethingelsehere"
    )


# ── Fit rule ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("width", "height"), [(1280, 720), (720, 1280), (720, 720)])
def test_a_very_long_stacked_caption_fits_the_safe_area(width, height, tmp_path):
    """
    One word a line, sixty words: far taller than the frame at 70%, so the
    font keeps shrinking until the box fits — in the layout and in the MP4.
    """
    text = " ".join(f"word{i}" for i in range(60))
    style = _style(line_style="stacked", words_per_line=1, max_lines=4, box_opacity=0.8, box_padding=20)
    layout = layout_caption(text, style, width, height)
    x, y, w, h = layout.ink
    assert layout.shrink < 0.7
    assert len(layout.lines) == 60
    assert x >= SAFE_AREA * width - 1e-6 and y >= SAFE_AREA * height - 1e-6
    assert x + w <= (1 - SAFE_AREA) * width + 1e-6 and y + h <= (1 - SAFE_AREA) * height + 1e-6

    frame = _burn([_caption(text)], style, width, height, tmp_path)[0]
    mask = np.any(np.abs(frame.astype(int) - 128) > 24, axis=2)
    rows, cols = np.nonzero(mask)
    assert rows.min() >= int(SAFE_AREA * height) and rows.max() + 1 <= (1 - SAFE_AREA) * height + 1
    assert cols.min() >= int(SAFE_AREA * width) and cols.max() + 1 <= (1 - SAFE_AREA) * width + 1


# ── Nothing existing changes ────────────────────────────────────────────


def test_existing_videos_burn_exactly_as_in_1_0_7():
    """
    Burn documents made by the v1.0.7 code (tests/data/burn-1.0.7.json) for
    four styles x three frames x six captions, one with a manual break: the
    migration gives every style Balanced and 2 words a line, and the same
    captions must produce the same Style line and Dialogue lines, byte for
    byte.
    """
    reference = json.loads((Path(__file__).parent / "data" / "burn-1.0.7.json").read_text(encoding="utf-8"))
    for name, overrides in reference["styles"].items():
        style = CaptionStyle(video_id=1, **{**default_style_fields(), **overrides})
        captions = [_caption(t, i) for i, t in enumerate(reference["texts"])]
        for width, height in reference["frames"]:
            doc = subtitles.to_ass(captions, style, width, height)
            lines = [line for line in doc.splitlines() if line.startswith(("Dialogue:", "Style:"))]
            assert lines == reference["documents"][f"{name}@{width}x{height}"], f"{name}@{width}x{height}"
