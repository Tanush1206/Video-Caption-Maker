"""Find and replace across a video's captions (v1.3.0)."""

import pytest

from app.services.caption import find_spans
from tests.test_exports import make_video

TEXTS = [
    "Ketan aage dekho. Dekh raha hoon yaar.",
    "Itni attention ketan ko.",
    "Ketan doesn't like, even I don't like so much of attention.",
    "Ketanji aa gaye.",
    "नमस्ते दोस्तों, नम आँखों से।",
]


async def captioned(client, headers, sample_video_bytes) -> tuple[int, list[int]]:
    video_id = await make_video(client, headers, sample_video_bytes)
    ids = []
    for i, text in enumerate(TEXTS):
        response = await client.post(
            f"/api/videos/{video_id}/captions", headers=headers,
            json={"start_ms": i * 1000, "end_ms": i * 1000 + 900, "text": text},
        )
        ids.append(response.json()["id"])
    return video_id, ids


async def replace(client, headers, video_id, **body):
    response = await client.post(f"/api/videos/{video_id}/captions/replace", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def texts(client, headers, video_id) -> list[str]:
    return [c["text"] for c in (await client.get(f"/api/videos/{video_id}/captions", headers=headers)).json()["items"]]


def test_whole_word_counts_indic_vowel_signs_as_part_of_the_word():
    """Regex `\\b` would split नमस्ते after "नम": its vowel signs aren't `\\w`."""
    text = "नमस्ते दोस्तों, नम आँखों से।"
    assert find_spans(text, "नम", match_case=True, whole_word=True) == [(16, 18)]
    assert len(find_spans(text, "नम", match_case=True, whole_word=False)) == 2


@pytest.mark.asyncio
async def test_the_preview_shows_every_match_and_changes_nothing(client, auth_headers, sample_video_bytes):
    video_id, ids = await captioned(client, auth_headers, sample_video_bytes)

    result = await replace(client, auth_headers, video_id, find="ketan", replace="Kangan")

    assert [m["id"] for m in result["matches"]] == ids[:4]
    assert result["occurrences"] == 4
    first = result["matches"][0]
    assert (first["before"], first["after"], first["spans"]) == (TEXTS[0], "Kangan aage dekho. Dekh raha hoon yaar.", [[0, 5]])
    assert not any(m["applied"] for m in result["matches"])
    assert await texts(client, auth_headers, video_id) == TEXTS


@pytest.mark.asyncio
async def test_match_case_and_whole_word(client, auth_headers, sample_video_bytes):
    video_id, ids = await captioned(client, auth_headers, sample_video_bytes)

    cased = await replace(client, auth_headers, video_id, find="Ketan", replace="X", match_case=True)
    whole = await replace(client, auth_headers, video_id, find="ketan", replace="X", whole_word=True)

    assert [m["id"] for m in cased["matches"]] == [ids[0], ids[2], ids[3]]
    # "Ketanji" is another word; "Ketan doesn't" is the word.
    assert [m["id"] for m in whole["matches"]] == ids[:3]


@pytest.mark.asyncio
async def test_replace_one_then_all_then_undo(client, auth_headers, sample_video_bytes):
    video_id, ids = await captioned(client, auth_headers, sample_video_bytes)

    one = await replace(client, auth_headers, video_id, find="ketan", replace="Kangan", whole_word=True,
                        caption_ids=[ids[1]], apply=True)
    assert [m["id"] for m in one["matches"] if m["applied"]] == [ids[1]]
    assert (await texts(client, auth_headers, video_id))[1] == "Itni attention Kangan ko."

    every = await replace(client, auth_headers, video_id, find="ketan", replace="Kangan", whole_word=True, apply=True)
    assert [m["id"] for m in every["matches"] if m["applied"]] == [ids[0], ids[2]]
    after = await texts(client, auth_headers, video_id)
    assert after[:4] == ["Kangan aage dekho. Dekh raha hoon yaar.", "Itni attention Kangan ko.",
                         "Kangan doesn't like, even I don't like so much of attention.", "Ketanji aa gaye."]

    # Undo puts back exactly what the replace showed as "before".
    undo = [{"id": m["id"], "text": m["before"]} for m in every["matches"] if m["applied"]]
    response = await client.post(f"/api/videos/{video_id}/captions/texts", headers=auth_headers, json={"items": undo})
    assert response.status_code == 200
    assert (await texts(client, auth_headers, video_id))[:3] == [TEXTS[0], "Itni attention Kangan ko.", TEXTS[2]]


@pytest.mark.asyncio
async def test_a_caption_is_never_replaced_to_nothing(client, auth_headers, sample_video_bytes):
    video_id, ids = await captioned(client, auth_headers, sample_video_bytes)

    result = await replace(client, auth_headers, video_id, find="Ketanji aa gaye.", replace="", apply=True)

    [match] = result["matches"]
    assert (match["empty"], match["applied"]) == (True, False)
    assert (await texts(client, auth_headers, video_id))[3] == "Ketanji aa gaye."


@pytest.mark.asyncio
async def test_exports_made_afterwards_have_the_new_text(client, auth_headers, sample_video_bytes, monkeypatch):
    """SRT and VTT on disk, and the subtitle file the burn draws from."""
    from app.database import AsyncSessionLocal
    from app.models.export import Export
    from app.services import rendering, storage
    from app.workers.export import _run

    video_id, _ = await captioned(client, auth_headers, sample_video_bytes)
    await replace(client, auth_headers, video_id, find="ketan", replace="Kangan", whole_word=True, apply=True)

    for fmt in ("srt", "vtt"):
        made = (await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": fmt})).json()
        async with AsyncSessionLocal() as session:
            body = storage.resolve((await session.get(Export, made["id"])).storage_path).read_text(encoding="utf-8")
        assert "Kangan aage dekho" in body and "Itni attention Kangan ko" in body, fmt
        assert "Ketan aage" not in body, fmt

    burned: list[str] = []
    real = rendering.burn_captions

    def keep(source, subtitle_file, destination, **kwargs):
        burned.append(subtitle_file.read_text(encoding="utf-8"))
        return real(source, subtitle_file, destination, **kwargs)

    monkeypatch.setattr(rendering, "burn_captions", keep)
    made = (await client.post(f"/api/videos/{video_id}/exports", headers=auth_headers, json={"format": "mp4"})).json()
    assert "error" not in await _run(made["id"])
    assert "Kangan" in burned[0] and "Ketan aage" not in burned[0]


@pytest.mark.asyncio
async def test_another_users_captions_are_not_found(client, auth_headers, second_user_headers, sample_video_bytes):
    video_id, ids = await captioned(client, auth_headers, sample_video_bytes)

    find = await client.post(f"/api/videos/{video_id}/captions/replace", headers=second_user_headers,
                             json={"find": "ketan", "replace": "x", "apply": True})
    put = await client.post(f"/api/videos/{video_id}/captions/texts", headers=second_user_headers,
                            json={"items": [{"id": ids[0], "text": "x"}]})

    assert (find.status_code, put.status_code) == (404, 404)
    assert await texts(client, auth_headers, video_id) == TEXTS
