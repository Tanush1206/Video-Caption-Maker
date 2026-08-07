"""
Pipeline tests.

Deliberately does NOT run Whisper. Loading a model and decoding audio takes
tens of seconds and needs a GPU, which would make the suite slow and
machine-dependent. What's tested here is everything around the model: audio
extraction, how segments become caption rows, progress and failure handling,
and ownership. The model itself is exercised by the end-to-end check with a
real video.
"""

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.models.video import Video, VideoStatus
from app.services import storage, transcription


async def upload(client, headers, content: bytes):
    return await client.post(
        "/api/videos", headers=headers, files={"file": ("clip.mp4", content, "video/mp4")}
    )


@pytest.mark.asyncio
async def test_upload_reports_queued_state(client, auth_headers, sample_video_bytes):
    body = (await upload(client, auth_headers, sample_video_bytes)).json()

    assert body["status"] == "pending"
    assert body["progress"] == 0
    assert body["stage"] is None


@pytest.mark.asyncio
async def test_captions_endpoint_is_empty_before_transcription(
    client, auth_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_captions_are_returned_in_sequence_order(
    client, auth_headers, sample_video_bytes
):
    """Insertion order must not decide read order — the query does."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    async with AsyncSessionLocal() as session:
        # Added deliberately out of order.
        for sequence, start in [(2, 4000), (0, 0), (1, 2000)]:
            session.add(
                Caption(
                    video_id=video_id,
                    sequence=sequence,
                    start_ms=start,
                    end_ms=start + 1500,
                    text=f"segment {sequence}",
                )
            )
        await session.commit()

    items = (
        await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)
    ).json()["items"]

    assert [c["sequence"] for c in items] == [0, 1, 2]
    assert [c["start_ms"] for c in items] == [0, 2000, 4000]


@pytest.mark.asyncio
async def test_captions_require_ownership(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(
        f"/api/videos/{video_id}/captions", headers=second_user_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_deleting_a_video_removes_its_captions(
    client, auth_headers, sample_video_bytes
):
    """Relies on ON DELETE CASCADE rather than application-level cleanup."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    async with AsyncSessionLocal() as session:
        session.add(
            Caption(video_id=video_id, sequence=0, start_ms=0, end_ms=1000, text="hello")
        )
        await session.commit()

    await client.delete(f"/api/videos/{video_id}", headers=auth_headers)

    async with AsyncSessionLocal() as session:
        remaining = (
            await session.execute(select(Caption).where(Caption.video_id == video_id))
        ).scalars().all()

    assert remaining == []


@pytest.mark.asyncio
async def test_retranscribe_resets_progress_and_error(
    client, auth_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        video.status = VideoStatus.FAILED
        video.error_message = "something went wrong"
        video.progress = 42
        video.stage = "transcribing"
        await session.commit()

    body = (
        await client.post(f"/api/videos/{video_id}/transcribe", headers=auth_headers)
    ).json()

    assert body["status"] == "pending"
    assert body["progress"] == 0
    assert body["stage"] is None
    assert body["error_message"] is None


@pytest.mark.asyncio
async def test_cannot_requeue_a_video_already_processing(
    client, auth_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    async with AsyncSessionLocal() as session:
        video = await session.get(Video, video_id)
        video.status = VideoStatus.PROCESSING
        await session.commit()

    response = await client.post(
        f"/api/videos/{video_id}/transcribe", headers=auth_headers
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_retranscribe_requires_ownership(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.post(
        f"/api/videos/{video_id}/transcribe", headers=second_user_headers
    )
    assert response.status_code == 404


def test_audio_extraction_produces_16khz_mono_wav(sample_video_bytes, tmp_path):
    """Whisper expects 16kHz mono; converting once up front is faster."""
    source = tmp_path / "in.mp4"
    source.write_bytes(sample_video_bytes)
    destination = tmp_path / "out.wav"

    transcription.extract_audio(source, destination)

    assert destination.exists()
    assert destination.stat().st_size > 0

    import json
    import subprocess

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=sample_rate,channels", "-of", "json", str(destination)],
        capture_output=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert stream["sample_rate"] == "16000"
    assert stream["channels"] == 1


def test_audio_extraction_raises_on_garbage_input(tmp_path):
    """Unlike thumbnails, no audio means no transcript — this must not pass silently."""
    source = tmp_path / "broken.mp4"
    source.write_bytes(b"definitely not a video")

    with pytest.raises(RuntimeError):
        transcription.extract_audio(source, tmp_path / "out.wav")


def test_silent_video_reports_a_readable_reason(sample_silent_video_bytes, tmp_path):
    """
    A video with no audio track is a valid file the user chose — the failure
    has to explain itself, not surface FFmpeg's "Output file does not contain
    any stream", which reads like an application bug.
    """
    source = tmp_path / "silent.mp4"
    source.write_bytes(sample_silent_video_bytes)

    assert transcription.has_audio_stream(source) is False

    with pytest.raises(RuntimeError, match="no audio track"):
        transcription.extract_audio(source, tmp_path / "out.wav")


def test_has_audio_stream_detects_a_real_track(sample_video_bytes, tmp_path):
    source = tmp_path / "with-audio.mp4"
    source.write_bytes(sample_video_bytes)

    assert transcription.has_audio_stream(source) is True


def test_storage_resolve_still_guards_the_pipeline_path():
    """The worker resolves paths from the DB; the guard must hold there too."""
    with pytest.raises(ValueError):
        storage.resolve("../../../etc/passwd")
