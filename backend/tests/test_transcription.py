"""
Pipeline tests.

Deliberately does NOT run Whisper. Loading a model and decoding audio takes
tens of seconds and needs a GPU, which would make the suite slow and
machine-dependent. What's tested here is everything around the model: audio
extraction, how segments become caption rows, progress and failure handling,
and ownership. The model itself is exercised by the end-to-end check with a
real video.
"""

from pathlib import Path
from types import SimpleNamespace

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


def test_nothing_past_the_no_speech_check_retries_without_it(tmp_path, monkeypatch):
    """
    Whisper small on fast Hindi skipped every window as "probably not speech"
    and the video finished with no captions and no error. An empty first pass
    is retried with the check off, and the video says the result is shaky.
    """
    from types import SimpleNamespace

    from app.services import transcription

    calls = []

    class Model:
        def transcribe(self, path, **options):
            calls.append(options)
            info = SimpleNamespace(duration=10.0, language="hi")
            if "no_speech_threshold" not in options:
                return iter([]), info
            word = SimpleNamespace(start=1.0, end=2.0, word=" नमस्ते")
            seg = SimpleNamespace(
                text=" नमस्ते", start=1.0, end=2.0, words=[word], avg_logprob=-1.2
            )
            return iter([seg]), info

    monkeypatch.setattr(transcription, "get_model", lambda: Model())
    monkeypatch.setattr(transcription, "silent_spans", lambda path: [])
    monkeypatch.setattr(transcription, "vocal_envelope", lambda path, *_: [])

    segments, language = transcription.transcribe(tmp_path / "a.wav", language="hi")

    assert [s.text for s in segments] == ["नमस्ते"]
    assert language == "hi"
    assert calls[1]["no_speech_threshold"] is None
    assert transcription.low_confidence_note == transcription.LOW_CONFIDENCE_NOTE


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
    for target in ("hi", "fr", "de", "nl", "bn", "mr", "ta", "ml", "es", "pt", "it", "ru"):
        assert languages.whisper_task("en", target) == "transcribe"
        assert languages.needs_translation("en", target) is True


def test_captions_in_the_spoken_language_need_no_translation():
    from app.services import languages

    assert languages.needs_translation("fr", languages.SAME) is False
    assert languages.needs_translation("fr", "fr") is False


def test_only_the_offered_languages_are_accepted():
    """
    The list is short on purpose: languages that have been checked, not the
    ninety-nine Whisper claims. Anything else must be refused rather than
    passed through to a model that will improvise — including the four left
    out after checking (Telugu: not in M2M100; Kannada, Gujarati, Punjabi:
    unusable output).
    """
    from app.services import languages

    assert languages.is_spoken_language("auto")
    assert languages.is_caption_language("same")
    for code in ("te", "kn", "gu", "pa"):
        assert not languages.is_caption_language(code)
    for code in ("en", "hi", "fr", "de", "nl", "bn", "mr", "ta", "ml", "es", "pt", "it", "ru"):
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

    monkeypatch.setattr("app.services.rag.get_client", lambda *a: Client())
    monkeypatch.setattr(translation, "RETRY_BACKOFF_SECONDS", 0)

    assert translation.translate_with_gemini(["one", "two", "three"], "fr", "test-key") is None


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

    monkeypatch.setattr("app.services.rag.get_client", lambda *a: Client())

    assert translation.translate_with_gemini(["one", "two", "three"], "fr", "test-key") == [
        "un", "two", "trois",
    ]


def test_translation_is_local_without_a_key(monkeypatch):
    """No key means M2M100 on this machine, with no notice — it is the default."""
    from app.services import translation

    seen = {}

    def fake_local(texts, target, *, source, on_progress=None, on_download=None):
        seen.update(source=source, target=target)
        return [f"{target}:{t}" for t in texts]

    monkeypatch.setattr(translation, "translate_locally", fake_local)

    result = translation.translate_texts(["one", "two"], "fr", source="en")
    assert result.texts == ["fr:one", "fr:two"]
    assert result.engine == "local"
    assert result.notice is None
    assert seen == {"source": "en", "target": "fr"}


def test_a_failing_gemini_falls_back_to_local_and_says_so(monkeypatch):
    """No network, quota or a bad key must never cost the user their translation."""
    from app.services import translation

    class Models:
        def generate_content(self, **kwargs):
            raise RuntimeError("429 RESOURCE_EXHAUSTED")

    class Client:
        models = Models()

    monkeypatch.setattr("app.services.rag.get_client", lambda *a: Client())
    monkeypatch.setattr(translation, "RETRY_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(
        translation,
        "translate_locally",
        lambda texts, target, **kw: [t.upper() for t in texts],
    )

    result = translation.translate_texts(["one"], "de", source="en", api_key="bad-key")
    assert result.texts == ["ONE"]
    assert result.engine == "local"
    assert result.notice == translation.GEMINI_FALLBACK_NOTICE


def test_a_working_gemini_is_used_when_a_key_is_set(monkeypatch):
    from app.services import translation

    class Response:
        text = '["eins"]'

    class Models:
        def generate_content(self, **kwargs):
            return Response()

    class Client:
        models = Models()

    monkeypatch.setattr("app.services.rag.get_client", lambda *a: Client())

    def must_not_run(*a, **k):
        raise AssertionError("local model used despite a working key")

    monkeypatch.setattr(translation, "translate_locally", must_not_run)

    result = translation.translate_texts(["one"], "de", source="en", api_key="key")
    assert result.texts == ["eins"]
    assert result.engine == "gemini"


def test_a_broken_local_model_keeps_the_original_captions(monkeypatch):
    """None, not an exception: the caller keeps the transcript and adds a notice."""
    from app.services import translation

    def broken(*a, **k):
        raise RuntimeError("model.bin is corrupt")

    monkeypatch.setattr(translation, "translate_locally", broken)
    assert translation.translate_texts(["one"], "nl", source="en") is None


def test_failed_jobs_get_a_sentence_not_a_traceback():
    from app.services.model_store import ModelDownloadError
    from app.workers.transcription import friendly_error

    oom = friendly_error(RuntimeError("CUDA failed with error out of memory"))
    assert "memory" in oom and "Settings" in oom
    assert "disk is full" in friendly_error(OSError(28, "No space left on device"))
    assert friendly_error(ModelDownloadError("Couldn't reach Hugging Face")) == (
        "Couldn't reach Hugging Face"
    )
    generic = friendly_error(KeyError("segments"))
    assert "segments" not in generic


# ── Caption length ─────────────────────────────────────────────────────────


def _segment(words: list[tuple[str, float, float]]):
    from types import SimpleNamespace

    ws = [SimpleNamespace(word=w, start=s, end=e) for w, s, e in words]
    return SimpleNamespace(
        text="".join(w for w, _, _ in words),
        start=words[0][1],
        end=words[-1][2],
        words=ws,
        avg_logprob=-0.2,
    )


def test_short_segments_pass_through_untouched():
    from app.services import transcription

    seg = _segment([(" Hello", 0.0, 0.4), (" there.", 0.4, 0.9)])
    assert list(transcription._split_long(seg)) == [seg]


def test_a_long_segment_becomes_readable_captions_with_their_own_timings():
    """large-v3 emits ~200-character segments; burned in, that is five lines."""
    from app.services import transcription

    words = [(f" word{i:02d}", i * 0.4, i * 0.4 + 0.35) for i in range(40)]
    pieces = list(transcription._split_long(_segment(words)))

    assert len(pieces) > 1
    assert all(len(p.text) <= transcription.MAX_CAPTION_CHARS for p in pieces)
    assert all(p.end - p.start <= transcription.MAX_CAPTION_SECONDS for p in pieces)
    # Nothing lost, nothing repeated, and in order.
    assert " ".join(p.text for p in pieces) == " ".join(w.strip() for w, _, _ in words)
    assert [p.start for p in pieces] == sorted(p.start for p in pieces)
    assert pieces[1].start == pytest.approx(pieces[0].words[-1].end + 0.05, abs=0.06)


def test_a_long_segment_breaks_after_a_clause_when_it_can():
    from app.services import transcription

    words = [(" This", 0, 0.3), (" is", 0.3, 0.5), (" the", 0.5, 0.7), (" first", 0.7, 1.0),
             (" sentence", 1.0, 1.4), (" of", 1.4, 1.5), (" a", 1.5, 1.6), (" fairly", 1.6, 1.9),
             (" long", 1.9, 2.1), (" caption.", 2.1, 2.6)]
    words += [(f" next{i}", 2.6 + i * 0.3, 2.85 + i * 0.3) for i in range(14)]
    pieces = list(transcription._split_long(_segment(words)))
    assert pieces[0].text.endswith("caption.")


def test_segments_without_word_timings_are_not_split():
    from types import SimpleNamespace

    from app.services import transcription

    seg = SimpleNamespace(text="x" * 300, start=0.0, end=20.0, words=None, avg_logprob=None)
    assert list(transcription._split_long(seg)) == [seg]


# ── Word starts on the waveform (v1.0.9) ────────────────────────────────


def _envelope(*stretches, total_ms=4000):
    """A 20 ms speech-band envelope: [(from_ms, to_ms, dB), ...] over silence."""
    from app.services.transcription import SILENT_DB, WORD_ONSET_WINDOW_MS

    levels = [SILENT_DB] * (total_ms // WORD_ONSET_WINDOW_MS)
    for start, end, db in stretches:
        for i in range(start // WORD_ONSET_WINDOW_MS, end // WORD_ONSET_WINDOW_MS):
            levels[i] = db
    return levels


def _onsets(speech, levels, start_ms=None):
    from app.services.transcription import Segment, _words_on_onsets

    segment = Segment(start_ms=start_ms or speech[0][0], end_ms=speech[-1][1], text="", confidence=None, speech=speech)
    return [s for s, _, _ in _words_on_onsets([segment], levels)[0].speech]


def test_a_word_after_a_short_pause_starts_where_the_voice_comes_back():
    """
    "और" was timed from the end of "करेगी" (13.16 s) and said at 13.52, after
    0.34 s of room tone 10-15 dB down: its caption came up 0.36 s early.
    """
    levels = _envelope((0, 1160, -20), (1160, 1220, -23), (1220, 1520, -36), (1520, 2400, -20))
    starts = _onsets([(800, 1160, "करेगी"), (1160, 1580, "और"), (1580, 1800, "आपके")], levels)
    assert starts == [800, 1520, 1580]


def test_a_word_timed_inside_the_silence_before_it_starts_on_the_voice():
    """ "You" timed from 32.24 s, into a pause, and said at 32.72. """
    levels = _envelope((0, 600, -20), (1480, 2400, -20))
    starts = _onsets([(1000, 1480, "You"), (1480, 1620, "can")], levels)
    assert starts == [1480, 1480]


def test_a_word_said_before_a_pause_stays_where_it_was_said():
    """ "two," was said in 0.12 s and Whisper stretched it over the 0.4 s pause after. """
    levels = _envelope((0, 600, -22), (1100, 2000, -20))
    starts = _onsets([(200, 480, "or"), (480, 980, "two,"), (1100, 1500, "depending")], levels)
    assert starts == [200, 480, 1100]


def test_a_consonant_closure_is_not_a_pause():
    """The "t" of "That's" is quiet for 0.14 s inside the word."""
    levels = _envelope((640, 760, -18), (760, 900, -40), (900, 1400, -16))
    starts = _onsets([(720, 980, "That's"), (980, 1140, "all")], levels)
    assert starts[0] == 720


def test_no_envelope_leaves_the_words_alone():
    from app.services.transcription import Segment, _words_on_onsets

    segment = Segment(start_ms=0, end_ms=500, text="a", confidence=None, speech=[(0, 500, "a")])
    assert _words_on_onsets([segment], [])[0].speech == [(0, 500, "a")]


def test_a_word_whisper_timed_at_zero_length_is_kept():
    """ "और" came back at 32.68-32.68; dropped, its caption began on the word after it. """
    from types import SimpleNamespace

    from app.services.transcription import _speech

    words = [SimpleNamespace(start=32.52, end=32.68, word=" हैं"), SimpleNamespace(start=32.68, end=32.68, word=" और"),
             SimpleNamespace(start=32.68, end=32.98, word=" क्लिप")]
    segment = SimpleNamespace(words=words)
    assert [w for _, _, w in _speech(segment, 32.52, 32.98)] == ["हैं", "और", "क्लिप"]


def test_word_timings_are_not_clipped_to_the_snapped_start(tmp_path, monkeypatch):
    """
    The caption's start moves to the waveform's onset; the words it is timed
    to must not. Clipped, the first words of 18 of 89 segments of the Hindi
    tutorial fell off and their captions drifted up to 2.6 s late.
    """
    from types import SimpleNamespace

    from app.services import transcription

    words = [SimpleNamespace(start=1.0, end=1.4, word=" तो"), SimpleNamespace(start=1.4, end=2.0, word=" वीडियो")]
    seg = SimpleNamespace(text=" तो वीडियो", start=1.0, end=2.0, words=words, avg_logprob=-0.3)

    class Model:
        def transcribe(self, path, **options):
            return iter([seg]), SimpleNamespace(duration=10.0, language="hi")

    monkeypatch.setattr(transcription, "get_model", lambda: Model())
    monkeypatch.setattr(transcription, "silent_spans", lambda path: [])
    monkeypatch.setattr(transcription, "vocal_envelope", lambda path, *_: [])
    monkeypatch.setattr(transcription, "_snap_to_onset", lambda start, end, levels, floor: 1.5)

    [segment], _ = transcription.transcribe(tmp_path / "a.wav", language="hi")
    assert segment.start_ms == 1500
    assert [w for _, _, w in segment.speech] == ["तो", "वीडियो"]
    assert segment.speech[0][0] == 1000


def test_a_zero_length_word_at_the_end_of_a_segment_is_kept():
    """ "है" at 43.80-43.80, where its segment ends. """
    from types import SimpleNamespace

    from app.services.transcription import _speech

    words = [SimpleNamespace(start=43.68, end=43.8, word=" रहा"), SimpleNamespace(start=43.8, end=43.8, word=" है")]
    assert [w for _, _, w in _speech(SimpleNamespace(words=words), 43.68, 43.8)] == ["रहा", "है"]


# ── Speech with no caption (v1.0.10) ────────────────────────────────────
#
# On the Hinglish tutorial large-v3 left 25.5-27.6 s and 77.5-80.0 s with no
# caption while someone spoke: a 2.1 s stretch too short for the 4 s
# re-decode rule, and a recovered segment thrown away because the onset
# snap had moved its start 0.23 s before the stretch it was found in.


def _seg(start, end, words):
    """A segment whose words are evenly spread over start-end (seconds)."""
    from app.services.transcription import Segment

    step = (end - start) / len(words)
    speech = [(int((start + i * step) * 1000), int((start + (i + 1) * step) * 1000), w) for i, w in enumerate(words)]
    return Segment(start_ms=int(start * 1000), end_ms=int(end * 1000), text=" ".join(words), confidence=-0.2, speech=speech)


def _levels(seconds, voiced=()):
    """A 250 ms envelope: quiet, loud at speaking level inside each (from, to)."""
    from app.services.transcription import ONSET_WINDOW_SECONDS

    out = [-60.0] * int(seconds / ONSET_WINDOW_SECONDS)
    for a, b in voiced:
        for i in range(int(a / ONSET_WINDOW_SECONDS), int(b / ONSET_WINDOW_SECONDS)):
            out[i] = -20.0
    return out


@pytest.fixture
def stretches(monkeypatch):
    """_fill_skipped with re-decoding faked: records the stretches asked for, answers from a table."""
    from app.services import transcription

    asked, answers = [], {}

    def decode_stretch(model, audio_path, start, end, *rest):
        asked.append((round(start, 2), round(end, 2)))
        return answers.get((round(start, 2), round(end, 2)), [])

    monkeypatch.setattr(transcription, "_decode_stretch", decode_stretch)
    monkeypatch.setattr(transcription, "_duration", lambda path: 30.0)
    return SimpleNamespace(asked=asked, answers=answers)


def test_a_short_stretch_of_speech_is_decoded_again(stretches):
    from app.services import transcription

    segments = [_seg(20.0, 25.5, ["a", "b", "c"]), _seg(27.6, 29.0, ["d", "e"])]
    levels = _levels(30, voiced=[(20, 29)])
    transcription._fill_skipped(None, Path("a.wav"), segments, "hi", "transcribe", [], levels, within=(20.0, 29.0))
    assert (25.5, 27.6) in stretches.asked


def test_a_short_silent_gap_is_not(stretches):
    from app.services import transcription

    segments = [_seg(20.0, 25.5, ["a", "b", "c"]), _seg(27.6, 29.0, ["d", "e"])]
    levels = _levels(30, voiced=[(20, 25.5), (27.6, 29)])
    transcription._fill_skipped(None, Path("a.wav"), segments, "hi", "transcribe", [], levels, within=(20.0, 29.0))
    assert stretches.asked == []


def test_gaps_are_measured_between_the_words(stretches):
    """A start the onset snap moved past its first word is no gap: decoding it said "Hamko bas" twice."""
    from app.services import transcription

    first = _seg(42.4, 43.7, ["kar", "rahe."])
    second = _seg(43.8, 45.6, ["Hamko", "bas", "SRT", "file"])
    second.start_ms = 44_500  # snapped; its words still start at 43.8
    levels = _levels(46, voiced=[(42.4, 45.6)])
    transcription._fill_skipped(None, Path("a.wav"), [first, second], "hi", "transcribe", [], levels, within=(42.4, 45.6))
    assert stretches.asked == []


def test_a_word_heard_on_both_sides_of_a_join_is_said_once(stretches):
    """The recovered "…सबसे पहले हम" met "हम यहीं देखेंगे"; the late-timed copy goes."""
    from app.services import transcription

    segments = [_seg(20.0, 25.5, ["दिखाना", "है"]), _seg(27.6, 29.0, ["हम", "यहीं", "देखेंगे"])]
    stretches.answers[(25.5, 27.6)] = [_seg(25.5, 27.6, ["कोई", "text", "सबसे", "पहले", "हम"])]
    levels = _levels(30, voiced=[(20, 29)])
    out = transcription._fill_skipped(None, Path("a.wav"), segments, "hi", "transcribe", [], levels, within=(20.0, 29.0))
    words = [w for s in out for w in s.text.split()]
    assert words == ["दिखाना", "है", "कोई", "text", "सबसे", "पहले", "हम", "यहीं", "देखेंगे"]


def test_the_same_words_in_another_script_count_as_said(stretches):
    """ "set करने के लिए" recovered, then "सेट करने के लिए हमें" from the segment after."""
    from app.services import transcription

    segments = [_seg(50.0, 56.2, ["पर", "क्लिक"]), _seg(57.7, 59.0, ["सेट", "करने", "के", "लिए", "हमें"])]
    stretches.answers[(56.2, 57.7)] = [_seg(56.2, 57.6, ["अपने", "caption", "set", "करने", "के", "लिए"])]
    levels = _levels(60, voiced=[(50, 59)])
    out = transcription._fill_skipped(None, Path("a.wav"), segments, "hi", "transcribe", [], levels, within=(50.0, 59.0))
    assert [s.text for s in out] == ["पर क्लिक", "अपने caption set करने के लिए", "हमें"]


def test_speech_that_gives_nothing_is_left_empty_and_logged(stretches, caplog):
    """Never invented: what Whisper won't say again stays uncaptioned."""
    import logging

    from app.services import transcription

    segments = [_seg(20.0, 25.5, ["a"]), _seg(27.6, 29.0, ["b"])]
    levels = _levels(30, voiced=[(20, 29)])
    with caplog.at_level(logging.INFO, logger="app.services.transcription"):
        out = transcription._fill_skipped(None, Path("a.wav"), segments, "hi", "transcribe", [], levels, within=(20.0, 29.0))
    assert [s.text for s in out] == ["a", "b"]
    assert "left uncaptioned" in caplog.text


def test_a_recovered_segment_the_snap_moved_back_is_kept(tmp_path, monkeypatch):
    """Found at 77.48 s with its start snapped to 77.25 s: it was thrown away, words and all."""
    import subprocess

    from app.services import transcription

    audio = tmp_path / "a.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=90", "-ar", "16000", str(audio)], check=True)
    found = _seg(77.48, 79.86, ["हम", "लोग", "डाउनलोड"])
    found.start_ms = 77_250
    monkeypatch.setattr(transcription, "_decode", lambda *a, **k: ([found], None))

    kept = transcription._decode_stretch(None, audio, 77.48, 87.74, "hi", "transcribe", [], [])
    assert [s.text for s in kept] == ["हम लोग डाउनलोड"]
