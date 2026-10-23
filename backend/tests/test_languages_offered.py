"""
The languages offered, and the four taken out in v1.0.11.

Tamil, Marathi, Bengali and Malayalam were offered from v1.0.7 and measured
weakest on FLEURS (docs/TESTING.md, "Language quality"). New jobs can't
choose them, as captions or as speech; videos made in them keep their
captions, open and export as before.
"""

import subprocess

import pytest

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.video import Video
from app.services import languages, storage

KEPT = ["en", "hi", "fr", "de", "nl", "es", "pt", "it", "ru"]
REMOVED = ["ta", "mr", "bn", "ml"]


async def _upload(client, headers, data, **form):
    return await client.post(
        "/api/videos", headers=headers,
        files={"file": ("clip.mp4", data, "video/mp4")}, data=form,
    )


async def test_only_the_kept_languages_are_offered(client, auth_headers):
    body = (await client.get("/api/videos/languages", headers=auth_headers)).json()

    assert [o["code"] for o in body["caption"]] == ["same", *KEPT]
    assert [o["code"] for o in body["spoken"]] == ["auto", *KEPT]


@pytest.mark.parametrize("code", REMOVED)
async def test_a_removed_language_cant_be_chosen_for_the_captions(
    client, auth_headers, sample_video_bytes, code
):
    response = await _upload(client, auth_headers, sample_video_bytes, caption_language=code)
    assert response.status_code == 422, response.text

    held = (await _upload(client, auth_headers, sample_video_bytes, hold="true")).json()
    response = await client.post(
        f"/api/videos/{held['id']}/transcribe", headers=auth_headers, json={"caption_language": code},
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("code", REMOVED)
async def test_a_removed_language_cant_be_chosen_as_the_speech(
    client, auth_headers, sample_video_bytes, code
):
    held = (await _upload(client, auth_headers, sample_video_bytes, hold="true")).json()
    response = await client.post(
        f"/api/videos/{held['id']}/transcribe", headers=auth_headers, json={"spoken_language": code},
    )
    assert response.status_code == 422, response.text


async def test_try_anyway_is_auto_and_is_accepted(client, auth_headers, sample_video_bytes, monkeypatch):
    """The language step's "Try anyway" sends auto: the job transcribes what it hears."""
    monkeypatch.setattr("app.api.videos._enqueue_transcription", lambda vid, keep_breaks=False: True)
    held = (await _upload(client, auth_headers, sample_video_bytes, hold="true")).json()
    response = await client.post(
        f"/api/videos/{held['id']}/transcribe", headers=auth_headers,
        json={"spoken_language": "auto", "caption_language": "same", "hindi_script": "auto"},
    )
    assert response.status_code == 200, response.text


def test_a_removed_language_is_still_named():
    assert languages.label("ta") == "Tamil"
    assert languages.label("ml") == "Malayalam"
    assert not languages.is_caption_language("ta") and not languages.is_spoken_language("ta")


async def test_a_video_made_in_a_removed_language_still_opens_and_exports(
    client, auth_headers, sample_video_bytes, tmp_path
):
    from app.workers.export import _run

    video_id = (await _upload(client, auth_headers, sample_video_bytes)).json()["id"]
    black = tmp_path / "black.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1:r=5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(black)],
        capture_output=True, timeout=120, check=True,
    )
    texts = ["நாம் சூப் செய்வோம்", "வெங்காயம் நறுக்கவும்"]
    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        storage.resolve(video.storage_path).write_bytes(black.read_bytes())
        # As a v1.0.10 job left it: Tamil heard, captions in Tamil.
        video.spoken_language = "ta"
        video.caption_language = "ta"
        video.detected_language = "ta"
        session.add_all([
            Caption(video_id=video_id, sequence=i, start_ms=i * 400, end_ms=(i + 1) * 400, text=t)
            for i, t in enumerate(texts)
        ])
        await session.commit()

    opened = await client.get(f"/api/videos/{video_id}", headers=auth_headers)
    assert opened.status_code == 200
    assert opened.json()["caption_language"] == "ta"
    captions = (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()
    assert [c["text"] for c in captions["items"]] == texts

    for fmt in ("srt", "mp4"):
        created = await client.post(
            f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt}
        )
        assert created.status_code in (200, 201, 202), created.text
        export = created.json()
        assert export["caption_language"] == "ta"
        if fmt == "mp4":
            assert "error" not in await _run(export["id"])
        else:
            from app.models.export import Export

            async with AsyncSessionLocal() as session:
                path = storage.resolve((await session.get(Export, export["id"])).storage_path)
            assert texts[0] in path.read_text(encoding="utf-8")
