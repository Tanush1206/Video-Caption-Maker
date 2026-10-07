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


class _FakeWord:
    """One aligned word, which is all _spoken_bounds reads off faster-whisper."""

    def __init__(self, start, end):
        self.start = start
        self.end = end


class _FakeSegment:
    """A decoded segment and its words, without loading a multi-GB model."""

    def __init__(self, start, end, words):
        self.start = start
        self.end = end
        self.words = words



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


# ── Silence handling ────────────────────────────────────────────────────
#
# These replace VAD. Silero VAD asks "is this speech?" and gets sung vocals
# wrong, discarding most of the audio in anything musical; these ask "is there
# any sound here at all?", which has an unambiguous answer.


def test_silent_fraction_measures_overlap():
    from app.services.transcription import _silent_fraction

    spans = [(0.0, 10.0), (20.0, 30.0)]

    assert _silent_fraction(2.0, 4.0, spans) == 1.0        # wholly inside
    assert _silent_fraction(12.0, 14.0, spans) == 0.0      # wholly outside
    assert _silent_fraction(8.0, 12.0, spans) == 0.5       # straddling the edge
    assert _silent_fraction(5.0, 5.0, spans) == 0.0        # zero length is not silent


def test_a_segment_invented_over_silence_is_dropped():
    """
    The behaviour VAD was switched on to get, without VAD's cost. Whisper
    reliably invents text over long silences; a segment sitting wholly inside
    measured silence cannot be anything else.
    """
    from app.services.transcription import SILENT_OVERLAP_TO_DROP, _silent_fraction

    spans = [(0.0, 116.0)]

    assert _silent_fraction(90.0, 95.0, spans) >= SILENT_OVERLAP_TO_DROP
    # Real speech starting right after the silence must survive.
    assert _silent_fraction(116.0, 121.0, spans) < SILENT_OVERLAP_TO_DROP


def test_a_segment_reaching_back_into_silence_is_clamped():
    """
    The "captions start at 0:00 but the audio starts at 1:56" bug.

    Whisper places a phrase boundary where it thinks speech began and reaches
    backwards over a silent intro — measured at 109.4s on a file whose audio
    starts at 116s. Nothing can have been said before there was any sound.
    """
    from app.services.transcription import _clamp_to_audible

    spans = [(0.0, 116.0)]

    assert _clamp_to_audible(109.42, 121.0, spans) == 116.0
    # Already audible: left alone.
    assert _clamp_to_audible(120.0, 125.0, spans) == 120.0
    # Trailing silence is not clamped - a caption held a little long is fine.
    assert _clamp_to_audible(200.0, 260.0, [(210.0, 260.0)]) == 200.0


def test_a_caption_starts_when_the_words_do_not_when_the_window_opened():
    """
    The "audio starts at 0:56 but the caption shows from 0:00" bug, in the case
    silence detection cannot see: an instrumental intro is not silent, so
    nothing in the waveform says the singing has not started yet.

    Whisper's segment bounds mark the decode window, not the sound. Measured on
    a song whose first line is sung at 17.34s, the segment claimed 0.0 — the
    caption sat over seventeen seconds of music. The word timestamps in the
    same result had it right.
    """
    from app.services.transcription import _spoken_bounds

    segment = _FakeSegment(
        start=0.0, end=27.0, words=[_FakeWord(17.34, 20.0), _FakeWord(20.0, 27.0)]
    )

    assert _spoken_bounds(segment) == (17.34, 27.0)


def test_a_caption_is_not_held_past_the_last_word():
    """
    The same error at the other end, and just as visible: measured at 131.0s
    for singing that stopped at 119.66 — eleven seconds of a caption sitting on
    screen over an instrumental break.
    """
    from app.services.transcription import _spoken_bounds

    segment = _FakeSegment(
        start=110.0, end=131.0, words=[_FakeWord(112.26, 115.0), _FakeWord(115.0, 119.66)]
    )

    assert _spoken_bounds(segment) == (112.26, 119.66)


def test_word_bounds_never_widen_a_segment():
    """
    Alignment can place a word fractionally outside the window it was decoded
    in. Believing that would reintroduce the same error from the other
    direction, so the segment's own bounds are the outer limit.
    """
    from app.services.transcription import _spoken_bounds

    segment = _FakeSegment(
        start=10.0, end=20.0, words=[_FakeWord(9.2, 12.0), _FakeWord(12.0, 20.8)]
    )

    assert _spoken_bounds(segment) == (10.0, 20.0)


@pytest.mark.parametrize(
    "words",
    [
        pytest.param([], id="alignment produced nothing"),
        pytest.param([_FakeWord(None, None)], id="a word with no timing"),
        pytest.param([_FakeWord(9.0, 3.0)], id="inverted, so the decoder wins"),
    ],
)
def test_unusable_word_timings_fall_back_to_the_segment(words):
    """
    Falling back rather than failing: a caption timed the old way is worse than
    one timed to its words and far better than one dropped or inverted.
    """
    from app.services.transcription import _spoken_bounds

    assert _spoken_bounds(_FakeSegment(start=4.0, end=8.0, words=words)) == (4.0, 8.0)


def test_a_start_moves_to_where_the_voice_arrives():
    """
    The last of the three timing fixes, and the one silence cannot do.

    An instrumental intro is not silent, so nothing in `silent_spans` says the
    singing has not started. Measured on a song whose caption began at 18.00s:
    the vocal enters at 18.50 with a +12.7 dB step in the speech band, and
    18.00 sits in the quiet bar before it.
    """
    from app.services.transcription import ONSET_WINDOW_SECONDS, _snap_to_onset

    # A quiet instrumental, then the voice, one value per 0.25s window.
    levels = [-24.0] * 74 + [-12.0] * 40

    start = _snap_to_onset(18.0, 27.0, levels, floor=0.0)

    assert start == 74 * ONSET_WINDOW_SECONDS == 18.5


def test_a_start_in_a_hole_moves_further_than_a_step_may():
    """
    The measured case the step detector cannot reach. A caption timed at 17.34s
    over an instrumental holding at -24 dB, singing from 18.50 at -12: 1.16s
    away, past ONSET_LOOKAHEAD_SECONDS.

    Widening the step detector to cover it was measured and rejected — 23
    captions in one video moved by over a second, past the words they time.
    This rule crosses the same distance safely because its limit is the
    caption's own loudness, not a clock.
    """
    from app.services.transcription import _snap_to_onset

    levels = [-24.0] * 74 + [-12.0] * 40

    assert _snap_to_onset(17.34, 27.0, levels, floor=0.0) == 18.5


def test_a_caption_that_is_quiet_throughout_is_not_dragged_forward():
    """
    The reference is the caption's *own* level, so a quiet line is quiet on
    both sides of the comparison and nothing moves. A fixed dB threshold would
    have marched every soft passage forward to wherever it got loud.
    """
    from app.services.transcription import _snap_to_onset

    levels = [-40.0] * 200

    assert _snap_to_onset(17.34, 27.0, levels, floor=0.0) == 17.34


def test_a_start_already_on_the_voice_is_left_alone():
    """A flat level has no step to find, so there is nothing to correct."""
    from app.services.transcription import _snap_to_onset

    assert _snap_to_onset(18.6, 27.0, [-12.0] * 200, floor=0.0) == 18.6


def test_the_first_jump_wins_not_the_biggest():
    """
    A sung phrase is usually loudest somewhere in its middle, so the biggest
    step in range is not where the line began. Measured over three videos,
    taking the biggest moved 47 captions by more than a second where taking the
    first moved 7.

    Tests the step detector directly: through `_snap_to_onset` the level rule
    would answer first, which is the whole point of the ordering.
    """
    from app.services.transcription import _steps_up

    # Voice enters at window 40 (+8 dB), swells further at 42 (+14 dB).
    levels = [-30.0] * 40 + [-22.0, -22.0] + [-8.0] * 40

    assert _steps_up(9.9, 20.0, levels, floor=0.0) == 10.0


def test_a_start_never_overlaps_the_caption_before_it():
    """
    The lookback lets a start move slightly earlier to catch an onset just in
    front of it, which must not walk it back into the previous line.
    """
    from app.services.transcription import _snap_to_onset

    # An onset at window 40 (10.0s), but the previous caption runs to 10.4s.
    levels = [-30.0] * 40 + [-10.0] * 40

    assert _snap_to_onset(10.2, 14.0, levels, floor=10.4) == 10.4


def test_a_start_is_untouched_when_the_envelope_is_missing():
    """
    The probe failing open, same as `silent_spans`: a caption timed by its
    words is a good caption, and losing one measurement must not lose the two
    that already ran.
    """
    from app.services.transcription import _snap_to_onset

    assert _snap_to_onset(17.34, 27.0, [], floor=0.0) == 17.34


def test_a_detected_language_is_used_as_detected():
    """
    Pins the *absence* of a substitution table, because there was one and it
    was justified by measurement.

    Under `medium`, Punjabi audio scored better transcribed as Hindi. Under
    `large-v3` it scores better as Punjabi (-0.108 against -0.204) and in the
    right script. The table encoded a weakness of one model, not a relationship
    between two languages, so it has to go when the model does — and a test
    that fails on its return is what makes that visible.
    """
    from app.services import languages

    assert not hasattr(languages, "substitute_for")
    assert not hasattr(languages, "TRANSCRIPTION_SUBSTITUTES")


def test_silent_spans_parses_ffmpeg_output(tmp_path, monkeypatch):
    """Parsed from silencedetect's log lines, which is where it reports."""
    import subprocess

    from app.services import transcription

    class Result:
        returncode = 0
        stderr = (
            b"[silencedetect @ 0x1] silence_start: 0\n"
            b"[silencedetect @ 0x1] silence_end: 116 | silence_duration: 116\n"
            b"[silencedetect @ 0x1] silence_start: 200.5\n"
        ).decode().encode()

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Result())

    spans = transcription.silent_spans(tmp_path / "x.wav")

    assert spans[0] == (0.0, 116.0)
    # A file that ends silent never reports an end; it runs to infinity.
    assert spans[1][0] == 200.5
    assert spans[1][1] == float("inf")


def test_an_unreadable_file_is_not_reported_as_having_no_audio(tmp_path, monkeypatch):
    """
    "This video has no audio track" was being shown for files ffprobe simply
    could not parse. Those are different problems and only one of them is a
    fact about the user's audio.
    """
    import subprocess

    import pytest as _pytest

    from app.services import transcription

    class Failed:
        returncode = 1
        stdout = b""
        stderr = b"moov atom not found"

    monkeypatch.setattr(subprocess, "run", lambda *a, **k: Failed())

    with _pytest.raises(RuntimeError, match="Could not read this video's streams"):
        transcription.has_audio_stream(tmp_path / "x.mp4")


# ── Caption language ────────────────────────────────────────────────────


def test_english_uses_whispers_own_translation():
    """
    Whisper's `translate` task has no target parameter - it means "into
    English" and nothing else. So English captions come free in the same pass
    that does the transcription, and never touch the translation service.
    """
    from app.services import languages

    assert languages.whisper_task("hi", "en") == "translate"
    assert languages.whisper_task("auto", "en") == "translate"


def test_english_audio_wanting_english_captions_is_not_translated():
    """Running the translate task on English audio is work that makes it worse."""
    from app.services import languages

    assert languages.whisper_task("en", "en") == "transcribe"


def test_every_other_language_is_transcribed_then_translated():
    from app.services import languages

    # Whisper cannot produce these directly, whatever the source.
    for target in ("hi", "fr", "de", "nl"):
        assert languages.whisper_task("en", target) == "transcribe"
        assert languages.needs_translation("en", target) is True


def test_captions_in_the_spoken_language_need_no_translation():
    from app.services import languages

    assert languages.needs_translation("fr", languages.SAME) is False
    assert languages.needs_translation("fr", "fr") is False


def test_only_the_offered_languages_are_accepted():
    """
    The list is short on purpose: five languages that have been checked, not
    the ninety-nine Whisper claims. Anything else must be refused rather than
    passed through to a model that will improvise.
    """
    from app.services import languages

    assert languages.is_spoken_language("auto")
    assert languages.is_caption_language("same")
    for code in ("en", "hi", "fr", "de", "nl"):
        assert languages.is_spoken_language(code)
        assert languages.is_caption_language(code)

    for bad in ("klingon", "zz", "", "same"):
        assert not languages.is_spoken_language(bad) or bad == "auto"
    # "same" is a caption target only; it is not something anyone speaks.
    assert not languages.is_spoken_language("same")
    assert not languages.is_caption_language("auto")


def test_translation_refuses_an_unknown_language():
    from app.services import translation

    assert translation.translate_texts(["hello"], "klingon") is None


def test_translation_will_not_return_a_misaligned_batch(monkeypatch):
    """
    The one failure that must never pass silently.

    Captions are paired with timings by position, so a short or reordered array
    would put every following line against the wrong moment - a transcript that
    looks fine and is wrong everywhere. Better to keep the original language.
    """
    from app.services import translation

    class Response:
        text = '["only one"]'

    class Models:
        def generate_content(self, **kwargs):
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr("app.services.rag.get_client", lambda: Client())
    monkeypatch.setattr(translation.settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(translation, "RETRY_BACKOFF_SECONDS", 0)

    assert translation.translate_texts(["one", "two", "three"], "fr") is None


def test_translation_keeps_the_original_for_a_blank_line(monkeypatch):
    """A model returning null for one line should not blank that caption."""
    from app.services import translation

    class Response:
        text = '["un", "", "trois"]'

    class Models:
        def generate_content(self, **kwargs):
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr("app.services.rag.get_client", lambda: Client())
    monkeypatch.setattr(translation.settings, "gemini_api_key", "test-key")

    assert translation.translate_texts(["one", "two", "three"], "fr") == [
        "un", "two", "trois",
    ]
