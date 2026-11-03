"""Improve captions with Gemini (v1.3.0): the guards, the run, Undo. Gemini itself is faked."""

import pytest

from app.models.caption_fix import CaptionFixRun
from app.models.video import Video, VideoStatus
from app.services import caption_fix
from app.workers import recovery
from tests.test_exports import make_video

# ── The guards, on what Gemini really proposed (PROGRESS.md, Part C) ────────


@pytest.mark.parametrize("before, after", [
    ("Main itna hari mein kaam", "Main itna hurry mein kaam"),          # sounds alike
    ("right side corona par caption", "right side corner par caption"),
    ("Ab aise to kai saare video rating software", "Ab aise to kai saare video editing software"),
    ("Now it's time for some Dlicious snacks", "Now it's time for some Delicious snacks"),
    ("kyonki yahaan par kuchh hai nahin.", "kyunki yahaan par kuchh hai nahin."),  # respelling
    ("Dekor kya hai? But abhi koi leak nahin hai.", "Decor kya hai? But abhi koi leak nahin hai."),
    ("jaana hai aur clip champ web", "jaana hai aur clipchamp web"),
    ("se apan abhi popins extra ball", "se apan abhi Poppins Extra Bold"),
    ("Itni attention ketan ko.", "Itni attention Ketan ko."),           # a name's capital
])
def test_a_fix_that_respells_or_swaps_a_sound_alike_word_is_kept(before, after):
    assert caption_fix.check(before, after) is None


@pytest.mark.parametrize("before, after, reason", [
    # The confident wrong edits seen in Part C.
    ("divaali party block 20 26 edition.", "divaali party vlog 20 23 edition.", "number"),
    ("but is baar main boot camp chaah raha hoon.", "but is baar main boot camp chhod raha hoon.", "different word"),
    ("but main blanket kar loongi.", "but main manage kar loongi.", "different word"),
    ("Yo ho party ho gai hai. This is a w light.", "Yo ho party ho gai hai. This is a double light.", "different word"),
    ("Nahin, just nahin hoti hai.", "Nahin, hazam nahin hoti hai.", "different word"),
    # A name is only ever respelled.
    ("Thank you guys Ketan aage dekho", "Thank you guys Chetan aage dekho", "name"),
    ("using the SRT file", "using the SST file", "name"),
    ("worry yah kaafi chizen to Aap", "worry yah kaafi chizen to App", "name"),
    # Never more than a few words, never added or removed words.
    ("ek do teen chaar paanch", "ek dho theen chhaar paanchh", "too many words"),
    ("Kya is mere? Aap vahaan par sone Plan kar rahe ho?", "Kya is mere? Aap vahaan par sone ka Plan kar rahe ho?", "adds or removes words"),
    ("the year 2026 was", "the year 2025 was", "number"),
    ("rakh ke split vaala button dabaane.", "rakh ke split vaala button dabaana hai.", "adds or removes words"),
    ("same text", "same  text", "unchanged"),
    ("something", "  ", "empty"),
])
def test_a_fix_that_changes_meaning_numbers_names_or_many_words_is_refused(before, after, reason):
    assert caption_fix.check(before, after) == reason


def test_a_name_written_as_one_anywhere_is_protected_everywhere():
    """Seen with flash-lite: "ketan" (lower-cased by speech recognition) became "kitni", same consonants."""
    texts = ["Ketan aage dekho.", "Thank you guys, Ketan doesn't like it", "Itni attention ketan ko."]
    names = caption_fix.names_in(texts)

    assert "ketan" in names
    assert caption_fix.check("Itni attention ketan ko.", "Itni attention kitni ko.", names) == "name"
    assert caption_fix.check("Itni attention ketan ko.", "Itni attention Ketan ko.", names) is None
    # Without the name, as when every caption has it lower-cased: same
    # consonants, but it no longer ends as it did, so another word.
    assert caption_fix.check("Itni attention ketan ko.", "Itni attention kitni ko.") == "different word"
    kept, dropped = caption_fix.accept(texts, [{"i": 2, "original": texts[2], "fixed": "Itni attention kitni ko."}])
    assert kept == [] and dropped == 1


def test_spelling_variants_sound_the_same():
    assert caption_fix.sound("kyonki") == caption_fix.sound("kyunki")
    assert caption_fix.sound("kaaphi") == caption_fix.sound("kaafi")
    assert caption_fix.sound("vah") == caption_fix.sound("woh")
    assert caption_fix.sound("chaah") != caption_fix.sound("chhod")


def test_only_aligned_unique_fixes_are_accepted():
    texts = ["Main itna hari mein kaam", "kyonki yahaan par", "but main blanket kar loongi."]
    kept, dropped = caption_fix.accept(texts, [
        {"i": 0, "original": "Main itna hari mein kaam", "fixed": "Main itna hurry mein kaam"},
        {"i": 0, "original": "Main itna hari mein kaam", "fixed": "Main itna hurry mein kaam"},  # twice
        {"i": 1, "original": "something else", "fixed": "kyunki yahaan par"},                # misaligned
        {"i": 2, "original": "but main blanket kar loongi.", "fixed": "but main manage kar loongi."},
        {"i": 9, "original": "x", "fixed": "y"},                                             # out of range
        "not an object",
    ])
    assert [(f.index, f.after) for f in kept] == [(0, "Main itna hurry mein kaam")]
    assert dropped == 5


def test_changed_words_are_marked_for_highlighting():
    before, after = caption_fix.word_parts("Main itna hari mein kaam", "Main itna hurry mein kaam")
    assert before == [{"text": "Main itna", "changed": False}, {"text": "hari", "changed": True},
                      {"text": "mein kaam", "changed": False}]
    assert after[1] == {"text": "hurry", "changed": True}


def test_the_estimate_uses_the_runs_own_pace():
    assert caption_fix.batches(1) == 1 and caption_fix.batches(121) == 3
    assert caption_fix.seconds_left(3, 0, None) == 3 * caption_fix.SECONDS_PER_BATCH_GUESS
    assert caption_fix.seconds_left(3, 1, 20.0) == 40


# ── The run, through the API and the worker ────────────────────────────────

TEXTS = ["Main itna hari mein kaam", "but main blanket kar loongi.", "kyonki yahaan par kuchh hai nahin."]


@pytest.fixture
def gemini(monkeypatch):
    """A key, a fake Gemini, and the worker run in place of the queue."""
    from app.services import app_settings

    state = {"key": "test-key", "proposals": None, "error": None, "queued": []}

    async def gemini_key(session):
        return state["key"]

    def propose(texts, api_key, model):
        if state["error"]:
            raise state["error"]
        used = state.get("used", model)
        if state["proposals"] is not None:
            return state["proposals"], used
        return [
            {"i": i, "original": t, "fixed": t.replace("hari", "hurry").replace("blanket", "manage")
             .replace("kyonki", "kyunki")}
            for i, t in enumerate(texts)
        ], used

    monkeypatch.setattr(app_settings, "gemini_key", gemini_key)
    monkeypatch.setattr(caption_fix, "propose", propose)
    monkeypatch.setattr("app.api.videos._enqueue_caption_check", lambda run_id: state["queued"].append(run_id) or True)
    monkeypatch.setattr("app.api.videos._queue_reindex", lambda *a: None)
    monkeypatch.setattr("app.workers.transcription.reindex_captions.delay", lambda *a: None)
    return state


async def captioned(client, headers, sample_video_bytes, db_session) -> int:
    video_id = await make_video(client, headers, sample_video_bytes)
    for i, text in enumerate(TEXTS):
        await client.post(f"/api/videos/{video_id}/captions", headers=headers,
                          json={"start_ms": i * 1000, "end_ms": i * 1000 + 900, "text": text})
    (await db_session.get(Video, video_id)).status = VideoStatus.COMPLETED
    await db_session.commit()
    return video_id


async def texts_of(client, headers, video_id) -> list[str]:
    return [c["text"] for c in (await client.get(f"/api/videos/{video_id}/captions", headers=headers)).json()["items"]]


async def checked(client, headers, video_id, gemini) -> dict:
    from app.workers.caption_fix import _run

    started = await client.post(f"/api/videos/{video_id}/captions/improve", headers=headers)
    assert started.status_code == 202, started.text
    assert started.json()["status"] == "queued" and started.json()["seconds_left"] > 0
    await _run(gemini["queued"][-1])
    return (await client.get(f"/api/videos/{video_id}/captions/improve", headers=headers)).json()


@pytest.mark.asyncio
async def test_a_check_fixes_only_what_passes_and_keeps_every_timing(
    client, auth_headers, sample_video_bytes, db_session, gemini
):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    timings = [(c["start_ms"], c["end_ms"]) for c in
               (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"]]

    run = await checked(client, auth_headers, video_id, gemini)

    assert run["status"] == "completed" and run["seconds_left"] is None
    assert run["batches_done"] == run["batches_total"] == 1
    assert run["fallback_batches"] == 0
    # "blanket" -> "manage" is a different word: refused.
    assert run["dropped"] == 1
    assert [(f["before"], f["after"]) for f in run["fixes"]] == [(TEXTS[0], "Main itna hurry mein kaam"),
                                                                  (TEXTS[2], "kyunki yahaan par kuchh hai nahin.")]
    assert run["fixes"][0]["after_words"][1] == {"text": "hurry", "changed": True}
    assert await texts_of(client, auth_headers, video_id) == [
        "Main itna hurry mein kaam", TEXTS[1], "kyunki yahaan par kuchh hai nahin."]
    after = [(c["start_ms"], c["end_ms"]) for c in
             (await client.get(f"/api/videos/{video_id}/captions", headers=auth_headers)).json()["items"]]
    assert after == timings
    # Exports read the captions: an SRT made now has the fixed text.
    from app.database import AsyncSessionLocal
    from app.models.export import Export
    from app.services import storage

    made = (await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": "srt"})).json()
    async with AsyncSessionLocal() as session:
        body = storage.resolve((await session.get(Export, made["id"])).storage_path).read_text(encoding="utf-8")
    assert "Main itna hurry mein kaam" in body and "hari" not in body


@pytest.mark.asyncio
async def test_undo_one_undo_all_and_an_edited_caption_keeps_its_edit(
    client, auth_headers, sample_video_bytes, db_session, gemini
):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    run = await checked(client, auth_headers, video_id, gemini)
    first, second = run["fixes"]

    undone = await client.post(f"/api/videos/{video_id}/captions/improve/undo?fix_id={first['id']}", headers=auth_headers)
    assert undone.status_code == 200
    assert [f["undone"] for f in undone.json()["fixes"]] == [True, False]
    assert (await texts_of(client, auth_headers, video_id))[0] == TEXTS[0]

    # Edited by hand after the fix: its Undo is refused, the edit stays.
    await client.patch(f"/api/captions/{second['caption_id']}", headers=auth_headers,
                       json={"text": "kyunki yahan par kuch nahin hai."})
    refused = await client.post(f"/api/videos/{video_id}/captions/improve/undo?fix_id={second['id']}", headers=auth_headers)
    assert refused.status_code == 409
    listed = (await client.get(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)).json()
    assert listed["fixes"][1]["edited"] is True
    everything = await client.post(f"/api/videos/{video_id}/captions/improve/undo", headers=auth_headers)
    assert everything.status_code == 200
    assert (await texts_of(client, auth_headers, video_id))[2] == "kyunki yahan par kuch nahin hai."


@pytest.mark.asyncio
async def test_undo_all_puts_every_caption_back(client, auth_headers, sample_video_bytes, db_session, gemini):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    await checked(client, auth_headers, video_id, gemini)

    response = await client.post(f"/api/videos/{video_id}/captions/improve/undo", headers=auth_headers)

    assert all(f["undone"] for f in response.json()["fixes"])
    assert await texts_of(client, auth_headers, video_id) == TEXTS


@pytest.mark.asyncio
async def test_it_needs_a_key_and_ready_captions_and_runs_one_at_a_time(
    client, auth_headers, sample_video_bytes, db_session, gemini
):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)

    gemini["key"] = ""
    no_key = await client.post(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)
    assert no_key.status_code == 409 and "Gemini key" in no_key.json()["detail"]
    assert gemini["queued"] == []

    gemini["key"] = "test-key"
    assert (await client.post(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)).status_code == 202
    again = await client.post(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)
    assert again.status_code == 409

    (await db_session.get(Video, video_id)).status = VideoStatus.PROCESSING
    await db_session.commit()
    other = await captioned(client, auth_headers, sample_video_bytes, db_session)
    (await db_session.get(Video, other)).status = VideoStatus.PROCESSING
    await db_session.commit()
    assert (await client.post(f"/api/videos/{other}/captions/improve", headers=auth_headers)).status_code == 409


@pytest.mark.asyncio
async def test_no_check_has_been_run_until_asked(client, auth_headers, sample_video_bytes, db_session, gemini):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    response = await client.get(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)
    assert response.status_code == 200 and response.json() is None
    assert gemini["queued"] == []


@pytest.mark.asyncio
async def test_a_spent_quota_changes_nothing_and_says_so(client, auth_headers, sample_video_bytes, db_session, gemini):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    gemini["error"] = caption_fix.QuotaExhausted()

    run = await checked(client, auth_headers, video_id, gemini)

    assert run["status"] == "failed" and run["error_message"] == caption_fix.QUOTA_MESSAGE
    assert run["fixes"] == []
    assert await texts_of(client, auth_headers, video_id) == TEXTS


@pytest.mark.asyncio
async def test_another_users_check_is_not_found(
    client, auth_headers, second_user_headers, sample_video_bytes, db_session, gemini
):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    for method, path in (("get", "improve"), ("post", "improve"), ("post", "improve/undo")):
        response = await getattr(client, method)(f"/api/videos/{video_id}/captions/{path}", headers=second_user_headers)
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_restart_closes_an_unfinished_check_without_changing_anything(
    client, auth_headers, sample_video_bytes, db_session, gemini
):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    started = await client.post(f"/api/videos/{video_id}/captions/improve", headers=auth_headers)
    run_id = started.json()["id"]

    result = await recovery.recover(db_session, held=set())

    assert run_id in result.failed_fix_runs
    db_session.expire_all()
    run = await db_session.get(CaptionFixRun, run_id)
    assert run.status == "failed" and "restart" in run.error_message
    assert await texts_of(client, auth_headers, video_id) == TEXTS


class FakeGemini:
    """Answers per model: an error message to raise, or proposals to return."""

    def __init__(self, answers: dict):
        self.answers, self.asked = answers, []

    def client(self, key):
        fake = self

        class Models:
            def generate_content(self, model, **kwargs):
                fake.asked.append(model)
                answer = fake.answers[model]
                if isinstance(answer, str):
                    raise RuntimeError(answer)
                import json
                return type("Response", (), {"text": json.dumps(answer)})()

        return type("Client", (), {"models": Models()})()


FIX = [{"i": 0, "original": "a", "fixed": "b"}]


@pytest.mark.parametrize("failure", [
    "503 UNAVAILABLE. This model is currently experiencing high demand.",
    "504 DEADLINE_EXCEEDED",
    "429 RESOURCE_EXHAUSTED",
    "Request timed out",
])
def test_a_busy_or_failing_flash_is_asked_once_more_on_flash_lite(monkeypatch, failure):
    gemini = FakeGemini({"gemini-flash-latest": failure, caption_fix.FALLBACK_MODEL: FIX})
    monkeypatch.setattr(caption_fix, "_client_for", gemini.client)

    assert caption_fix.propose(["a"], "k", "gemini-flash-latest") == (FIX, caption_fix.FALLBACK_MODEL)
    assert gemini.asked == ["gemini-flash-latest", caption_fix.FALLBACK_MODEL]


def test_flash_answering_is_used_and_flash_lite_never_asked(monkeypatch):
    gemini = FakeGemini({"gemini-flash-latest": FIX, caption_fix.FALLBACK_MODEL: "must not be asked"})
    monkeypatch.setattr(caption_fix, "_client_for", gemini.client)

    assert caption_fix.propose(["a"], "k", "gemini-flash-latest") == (FIX, "gemini-flash-latest")
    assert gemini.asked == ["gemini-flash-latest"]


def test_both_failing_says_why_and_flash_lite_is_not_asked_twice(monkeypatch):
    busy = FakeGemini({"gemini-flash-latest": "503 high demand", caption_fix.FALLBACK_MODEL: "503 high demand"})
    monkeypatch.setattr(caption_fix, "_client_for", busy.client)
    with pytest.raises(caption_fix.GeminiUnavailable):
        caption_fix.propose(["a"], "k", "gemini-flash-latest")
    assert len(busy.asked) == 2

    spent = FakeGemini({"gemini-flash-latest": "504", caption_fix.FALLBACK_MODEL: "429 RESOURCE_EXHAUSTED"})
    monkeypatch.setattr(caption_fix, "_client_for", spent.client)
    with pytest.raises(caption_fix.QuotaExhausted):
        caption_fix.propose(["a"], "k", "gemini-flash-latest")

    # Configured as flash-lite already: one request, no second try of the same.
    lite = FakeGemini({caption_fix.FALLBACK_MODEL: "503 high demand"})
    monkeypatch.setattr(caption_fix, "_client_for", lite.client)
    with pytest.raises(caption_fix.GeminiUnavailable):
        caption_fix.propose(["a"], "k", caption_fix.FALLBACK_MODEL)
    assert lite.asked == [caption_fix.FALLBACK_MODEL]


@pytest.mark.asyncio
async def test_a_check_answered_by_flash_lite_says_so(client, auth_headers, sample_video_bytes, db_session, gemini):
    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    gemini["used"] = caption_fix.FALLBACK_MODEL

    run = await checked(client, auth_headers, video_id, gemini)

    assert run["status"] == "completed" and run["fallback_batches"] == run["batches_total"] == 1
    gemini.pop("used")
    again = await client.post(f"/api/videos/{video_id}/captions/improve/undo", headers=auth_headers)
    assert again.status_code == 200


@pytest.mark.asyncio
async def test_after_flash_fails_once_the_rest_of_the_run_asks_flash_lite(
    client, auth_headers, sample_video_bytes, db_session, gemini, monkeypatch
):
    """A flash timeout costs up to five minutes; it isn't paid again for every part."""
    from app.config import get_settings

    video_id = await captioned(client, auth_headers, sample_video_bytes, db_session)
    monkeypatch.setattr(caption_fix, "BATCH_SIZE", 1)
    asked = []

    def propose(texts, api_key, model):
        asked.append(model)
        return [], caption_fix.FALLBACK_MODEL

    monkeypatch.setattr(caption_fix, "propose", propose)
    run = await checked(client, auth_headers, video_id, gemini)

    assert asked == [get_settings().gemini_model] + [caption_fix.FALLBACK_MODEL] * (len(TEXTS) - 1)
    assert run["fallback_batches"] == run["batches_total"] == len(TEXTS)
