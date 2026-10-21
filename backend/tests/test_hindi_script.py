"""
Hindi in Roman script (Hinglish) or Devanagari, and the language step that asks (v1.0.9).

The flow: the file uploads when picked ("held"), the worker listens to the
first 30 s, the step presets Hinglish for Hindi heard at 70% or more and
asks otherwise, and Start is POST /{id}/transcribe. A held upload is in no
list, no count and no recovery, and is swept if never started.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.video import Video, VideoStatus
from app.services import languages


async def _upload(client, headers, data, **form) -> dict:
    response = await client.post(
        "/api/videos", headers=headers,
        files={"file": ("clip.mp4", data, "video/mp4")}, data=form,
    )
    assert response.status_code == 201, response.text
    return response.json()


# ── The rule ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "heard, confidence, preset",
    [("hi", 0.94, "roman"), ("hi", 0.70, "roman"), ("hi", 0.69, None), ("mr", 0.95, None),
     ("en", 0.99, None), (None, None, None)],
)
def test_hinglish_is_preset_only_for_hindi_heard_at_70_percent_or_more(heard, confidence, preset):
    assert languages.default_hindi_script(heard, confidence) == preset


def test_a_job_keeps_a_choice_applies_auto_and_treats_old_videos_as_devanagari():
    assert languages.hindi_script_for("roman", "hi", 0.2) == "roman"
    assert languages.hindi_script_for("devanagari", "hi", 0.99) == "devanagari"
    assert languages.hindi_script_for("auto", "hi", 0.9) == "roman"
    assert languages.hindi_script_for("auto", "hi", 0.5) == "devanagari"
    # Before v1.0.9, and clients that don't send one: as Hindi always was.
    assert languages.hindi_script_for(None, "hi", 0.99) == "devanagari"


# ── The API ─────────────────────────────────────────────────────────────


async def test_a_held_upload_is_listened_to_not_transcribed(
    client, auth_headers, sample_video_bytes, monkeypatch
):
    queued, detected = [], []
    monkeypatch.setattr("app.api.videos._enqueue_transcription", lambda vid, keep_breaks=False: queued.append(vid))
    monkeypatch.setattr("app.api.videos._enqueue_detection", lambda vid: detected.append(vid))

    video = await _upload(client, auth_headers, sample_video_bytes, hold="true")

    assert video["held"] is True and video["stage"] == "detecting"
    assert detected == [video["id"]] and queued == []


async def test_a_held_upload_is_in_no_list_and_no_count(client, auth_headers, sample_video_bytes):
    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")
    listed = (await client.get("/api/videos", headers=auth_headers)).json()
    assert held["id"] not in [v["id"] for v in listed["items"]]
    stats = (await client.get("/api/stats", headers=auth_headers)).json()
    assert sum(stats["by_status"].values()) == listed["total"]
    # Still readable by id: the language step polls it.
    assert (await client.get(f"/api/videos/{held['id']}", headers=auth_headers)).status_code == 200


async def test_start_records_the_script_and_queues_the_job(
    client, auth_headers, sample_video_bytes, monkeypatch
):
    queued = []
    monkeypatch.setattr("app.api.videos._enqueue_transcription", lambda vid, keep_breaks=False: queued.append(vid) or True)
    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")

    response = await client.post(
        f"/api/videos/{held['id']}/transcribe", headers=auth_headers,
        json={"spoken_language": "hi", "caption_language": "same", "hindi_script": "roman"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["held"] is False and body["hindi_script"] == "roman" and body["spoken_language"] == "hi"
    assert queued == [held["id"]]
    listed = (await client.get("/api/videos", headers=auth_headers)).json()
    assert held["id"] in [v["id"] for v in listed["items"]]


async def test_an_unknown_script_is_refused(client, auth_headers, sample_video_bytes):
    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")
    response = await client.post(
        f"/api/videos/{held['id']}/transcribe", headers=auth_headers, json={"hindi_script": "latin"},
    )
    assert response.status_code == 422


async def test_an_upload_without_hold_is_transcribed_straight_away_as_before(
    client, auth_headers, sample_video_bytes, monkeypatch
):
    queued = []
    monkeypatch.setattr("app.api.videos._enqueue_transcription", lambda vid, keep_breaks=False: queued.append(vid))
    video = await _upload(client, auth_headers, sample_video_bytes)
    assert video["held"] is False and video["hindi_script"] is None and queued == [video["id"]]


async def test_an_upload_never_started_is_swept_after_an_hour(client, auth_headers, sample_video_bytes):
    old = await _upload(client, auth_headers, sample_video_bytes, hold="true")
    recent = await _upload(client, auth_headers, sample_video_bytes, hold="true")
    async with AsyncSessionLocal() as session:
        (await session.get(Video, old["id"])).created_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await session.commit()

    await _upload(client, auth_headers, sample_video_bytes)

    assert (await client.get(f"/api/videos/{old['id']}", headers=auth_headers)).status_code == 404
    assert (await client.get(f"/api/videos/{recent['id']}", headers=auth_headers)).status_code == 200


async def test_recovery_never_starts_a_held_upload(client, auth_headers, sample_video_bytes, db_session):
    from app.workers import recovery

    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")
    result = await recovery.recover(db_session, held=set())
    assert held["id"] not in result.videos


async def test_the_options_offer_both_scripts_and_say_what_hinglish_downloads(
    client, auth_headers, monkeypatch
):
    from app.services import hinglish

    monkeypatch.setattr(hinglish, "apex_ready", lambda: False)
    options = (await client.get("/api/videos/languages", headers=auth_headers)).json()
    scripts = {s["code"]: s for s in options["hindi_scripts"]}
    assert scripts["roman"]["label"] == "Hinglish (Roman)" and scripts["roman"]["download_bytes"] > 1_500_000_000
    assert scripts["devanagari"]["download_bytes"] is None
    assert options["hinglish_min_confidence"] == 0.7

    monkeypatch.setattr(hinglish, "apex_ready", lambda: True)
    options = (await client.get("/api/videos/languages", headers=auth_headers)).json()
    assert all(s["download_bytes"] is None for s in options["hindi_scripts"])


# ── The job ─────────────────────────────────────────────────────────────


@pytest.fixture
def fake_pipeline(monkeypatch):
    """The job with speech recognition and translation faked; records what it was asked."""
    from app.services import embeddings, hinglish, transcription, translation

    calls = SimpleNamespace(loaded=[], transcribed=[], devanagari=[], translated=[])
    monkeypatch.setattr(transcription, "load_model", lambda profile, *a, **k: calls.loaded.append(profile.model))
    monkeypatch.setattr(transcription, "extract_audio", lambda source, dest, *a: Path(dest).write_bytes(b""))
    monkeypatch.setattr(transcription, "detect_language", lambda path: ("hi", 0.94))
    segments = [SimpleNamespace(start_ms=0, end_ms=1500, text="Aap SRT file kaise banate ho", confidence=-0.1, speech=[])]

    def transcribe(path, language, task, on_progress=None):
        calls.transcribed.append((language, task))
        return segments, language

    monkeypatch.setattr(transcription, "transcribe", transcribe)
    monkeypatch.setattr(hinglish, "to_devanagari", lambda texts, *a: calls.devanagari.append(texts) or ["आप SRT फाइल"])

    def translate(texts, target, source=None, **kw):
        calls.translated.append((texts, target, source))
        return SimpleNamespace(texts=["¿Cómo haces un archivo SRT?"], engine="local", notice=None)

    monkeypatch.setattr(translation, "translate_texts", translate)
    monkeypatch.setattr(embeddings, "delete_video_vectors", lambda *a: None)
    monkeypatch.setattr(embeddings, "index_captions", lambda *a: None)
    return calls


async def _video(client, headers, data, **fields) -> int:
    video_id = (await _upload(client, headers, data))["id"]
    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        for key, value in fields.items():
            setattr(video, key, value)
        await session.commit()
    return video_id


async def _captions(video_id: int) -> list[str]:
    async with AsyncSessionLocal() as session:
        return list((await session.execute(
            select(Caption.text).where(Caption.video_id == video_id).order_by(Caption.sequence)
        )).scalars())


async def test_hindi_in_roman_runs_on_the_hinglish_model(client, auth_headers, sample_video_bytes, fake_pipeline):
    from app.services.transcription import HINGLISH
    from app.workers import transcription as job

    video_id = await _video(client, auth_headers, sample_video_bytes, hindi_script="roman")
    await job._run(video_id)

    assert fake_pipeline.loaded[-1] == HINGLISH
    # Apex writes Hinglish under the English token, as its card says.
    assert fake_pipeline.transcribed == [("en", "transcribe")]
    assert fake_pipeline.translated == []
    assert await _captions(video_id) == ["Aap SRT file kaise banate ho"]


async def test_auto_decides_from_detection_and_is_remembered(client, auth_headers, sample_video_bytes, fake_pipeline):
    from app.services.transcription import HINGLISH
    from app.workers import transcription as job

    video_id = await _video(client, auth_headers, sample_video_bytes, hindi_script="auto")
    await job._run(video_id)

    assert fake_pipeline.loaded[-1] == HINGLISH
    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        assert video.hindi_script == "roman" and video.status == VideoStatus.COMPLETED
        # What was heard, so the editor's Redo offers the script choice.
        assert (video.detected_language, video.detected_confidence) == ("hi", 0.94)


async def test_a_video_from_before_stays_in_devanagari(client, auth_headers, sample_video_bytes, fake_pipeline):
    """No script recorded (v1.0.8 and earlier): Whisper's Hindi, exactly as before."""
    from app.services.transcription import HINGLISH
    from app.workers import transcription as job

    video_id = await _video(client, auth_headers, sample_video_bytes)
    await job._run(video_id)

    assert HINGLISH not in fake_pipeline.loaded
    assert fake_pipeline.transcribed == [("hi", "transcribe")]


async def test_a_translation_of_hinglish_is_made_from_devanagari(
    client, auth_headers, sample_video_bytes, fake_pipeline
):
    """M2M100 can't read Roman Hinglish; it gets IndicXlit's Devanagari, as Hindi."""
    from app.workers import transcription as job

    video_id = await _video(client, auth_headers, sample_video_bytes, hindi_script="roman", caption_language="es")
    await job._run(video_id)

    assert fake_pipeline.devanagari == [["Aap SRT file kaise banate ho"]]
    assert fake_pipeline.translated == [(["आप SRT फाइल"], "es", "hi")]
    assert await _captions(video_id) == ["¿Cómo haces un archivo SRT?"]


async def test_english_captions_still_come_from_whispers_own_translation(
    client, auth_headers, sample_video_bytes, fake_pipeline
):
    from app.services.transcription import HINGLISH
    from app.workers import transcription as job

    video_id = await _video(client, auth_headers, sample_video_bytes, hindi_script="roman", caption_language="en")
    await job._run(video_id)

    assert HINGLISH not in fake_pipeline.loaded
    assert fake_pipeline.transcribed == [("hi", "translate")]


async def test_the_language_steps_detection_is_stored(client, auth_headers, sample_video_bytes, monkeypatch):
    from app.services import transcription
    from app.workers import transcription as job

    monkeypatch.setattr(transcription, "load_model", lambda *a, **k: None)
    clips = []
    monkeypatch.setattr(transcription, "extract_audio", lambda source, dest, seconds=None: clips.append(seconds) or Path(dest).write_bytes(b""))
    monkeypatch.setattr(transcription, "detect_language", lambda path: ("hi", 0.9412))
    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")

    await job._detect(held["id"])

    body = (await client.get(f"/api/videos/{held['id']}", headers=auth_headers)).json()
    assert (body["detected_language"], body["detected_confidence"], body["stage"]) == ("hi", 0.941, None)
    # Only the window detection listens to.
    assert clips == [transcription.DETECTION_SECONDS]


async def test_a_failed_detection_stops_showing_detecting(client, auth_headers, sample_video_bytes, monkeypatch):
    """A file with no usable audio: the step asks without a preset instead of waiting."""
    from app.services import transcription
    from app.workers import transcription as job

    monkeypatch.setattr(transcription, "load_model", lambda *a, **k: None)

    def no_audio(*a, **k):
        raise RuntimeError("This video has no audio track, so there is nothing to transcribe")

    monkeypatch.setattr(transcription, "extract_audio", no_audio)
    held = await _upload(client, auth_headers, sample_video_bytes, hold="true")

    result = await asyncio.to_thread(job.detect_spoken_language, held["id"])

    assert "error" in result
    body = (await client.get(f"/api/videos/{held['id']}", headers=auth_headers)).json()
    assert body["stage"] is None and body["detected_language"] is None
