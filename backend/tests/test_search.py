"""Semantic search, ownership scoping, and grounded answering."""

import pytest

from app.database import AsyncSessionLocal
from app.models.caption import Caption
from app.services import rag, search
from app.services.search import SearchHit


async def make_video(client, headers, sample_video_bytes) -> int:
    response = await client.post(
        "/api/videos",
        headers=headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
    )
    return response.json()["id"]


async def seed(video_id: int, texts: list[str]) -> list[int]:
    async with AsyncSessionLocal() as session:
        rows = [
            Caption(
                video_id=video_id,
                sequence=i,
                start_ms=i * 2000,
                end_ms=(i + 1) * 2000,
                text=text,
            )
            for i, text in enumerate(texts)
        ]
        session.add_all(rows)
        await session.commit()
        return [row.id for row in rows]


def a_hit(text="the pricing works out at ten pounds a month", **overrides) -> SearchHit:
    base = dict(
        video_id=1, caption_id=1, start_ms=4000, end_ms=6000, text=text, distance=0.3
    )
    return SearchHit(**{**base, **overrides})


# ── Scoring ──────────────────────────────────────────────────────────────


def test_score_inverts_distance():
    """Cosine distance is lower-is-better; an API reads better the other way."""
    assert a_hit(distance=0.0).score == 1.0
    assert a_hit(distance=0.25).score == 0.75
    # Clamped rather than negative: distances can exceed 1 on opposed vectors.
    assert a_hit(distance=1.4).score == 0.0


# ── Ownership scoping ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_scope_is_resolved_from_the_database(
    client, auth_headers, second_user_headers, sample_video_bytes, db_session
):
    """
    The security property of this milestone.

    ChromaDB has no concept of ownership: whatever video ids reach its filter
    are what gets searched. If those came from the request instead of from
    Postgres, anyone could read every transcript in the database.
    """
    mine = await make_video(client, auth_headers, sample_video_bytes)
    theirs = await make_video(client, second_user_headers, sample_video_bytes)

    async with AsyncSessionLocal() as session:
        from sqlalchemy import select

        from app.models.video import Video

        my_owner = (
            await session.execute(select(Video.owner_id).where(Video.id == mine))
        ).scalar_one()

    visible = await search.owned_video_ids(db_session, my_owner)

    assert mine in visible
    assert theirs not in visible


@pytest.mark.asyncio
async def test_searching_someone_elses_video_is_a_404(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    """404, not 403 — a 403 would confirm the id is real."""
    theirs = await make_video(client, second_user_headers, sample_video_bytes)

    response = await client.get(
        f"/api/search?q=anything&video_id={theirs}", headers=auth_headers
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_search_requires_authentication(client):
    assert (await client.get("/api/search?q=hello")).status_code == 401
    assert (await client.post("/api/ask", json={"question": "hello"})).status_code == 401


@pytest.mark.asyncio
async def test_query_is_validated(client, auth_headers):
    """A one-character query matches everything and means nothing."""
    assert (await client.get("/api/search?q=a", headers=auth_headers)).status_code == 422
    assert (
        await client.post("/api/ask", headers=auth_headers, json={"question": "a"})
    ).status_code == 422


def test_no_videos_means_no_query():
    """A user with nothing indexed must not fall through to an unfiltered search."""
    assert search.search_vectors("anything", [], 10) == []


# ── Retrieval quality gate ───────────────────────────────────────────────


def test_distant_hits_are_discarded(monkeypatch):
    """
    Chroma always returns its nearest neighbours, however far away they are.
    Without a threshold, a question about something the video never mentions
    still comes back with its most-nearly-related caption — which is exactly
    how a confident wrong answer gets built.
    """

    class FakeCollection:
        def query(self, **_kwargs):
            return {
                "documents": [["about right", "nothing like it"]],
                "metadatas": [
                    [
                        {"video_id": 1, "caption_id": 1, "start_ms": 0, "end_ms": 1},
                        {"video_id": 1, "caption_id": 2, "start_ms": 2, "end_ms": 3},
                    ]
                ],
                "distances": [[0.2, 0.95]],
            }

    class FakeEncoder:
        def encode(self, _texts):
            class Vector(list):
                def tolist(self):
                    return [0.0]

            return [Vector()]

    monkeypatch.setattr(search.embeddings, "get_encoder", lambda: FakeEncoder())
    monkeypatch.setattr(search.embeddings, "get_collection", lambda: FakeCollection())

    hits = search.search_vectors("question", [1], 10)

    assert [hit.text for hit in hits] == ["about right"]


# ── Grounding: the criterion this milestone is judged on ─────────────────


def test_no_retrieval_refuses_without_calling_the_model(monkeypatch):
    """
    The first line of defence.

    With no context there is nothing to answer from, so the model is never
    asked. Handing it an empty context and hoping it admits ignorance is not a
    safety mechanism.
    """
    def explode():
        raise AssertionError("the model must not be called with no context")

    monkeypatch.setattr(rag, "get_client", explode)

    answer = rag.answer_question("what is the refund policy", [])

    assert answer.text == rag.NOT_FOUND
    assert answer.grounded is False
    assert answer.cited == []


def test_model_refusal_is_reported_as_not_grounded(monkeypatch):
    """The second line: context existed, but it didn't answer the question."""
    monkeypatch.setattr(rag, "get_client", lambda: _FakeClient(rag.NOT_FOUND))
    monkeypatch.setattr(rag.settings, "gemini_api_key", "test-key")

    answer = rag.answer_question("what is the refund policy", [a_hit()])

    assert answer.text == rag.NOT_FOUND
    assert answer.grounded is False
    assert answer.cited == []


def test_a_grounded_answer_keeps_its_citations(monkeypatch):
    monkeypatch.setattr(
        rag, "get_client", lambda: _FakeClient("It costs ten pounds a month [1].")
    )
    monkeypatch.setattr(rag.settings, "gemini_api_key", "test-key")

    answer = rag.answer_question("how much is it", [a_hit(), a_hit(caption_id=2)])

    assert answer.grounded is True
    assert answer.cited == [0]


def test_a_model_failure_degrades_to_search(monkeypatch):
    """The captions are useful on their own; a dead API must not lose them."""

    class Broken:
        @property
        def models(self):
            raise RuntimeError("network down")

    monkeypatch.setattr(rag, "get_client", lambda: Broken())
    monkeypatch.setattr(rag.settings, "gemini_api_key", "test-key")

    answer = rag.answer_question("how much is it", [a_hit()])

    assert answer.grounded is False
    assert "unavailable" in answer.text


# ── Citations ────────────────────────────────────────────────────────────


def test_citations_outside_the_provided_range_are_dropped():
    """
    A citation to an excerpt that was never supplied is a hallucinated one.
    Clamping it to a real caption would attach a genuine-looking timestamp to
    a claim nothing supports, which is worse than losing the citation.
    """
    assert rag.parse_citations("see [1] and [7] and [0]", hit_count=3) == [0]


def test_citations_are_deduplicated_and_ordered():
    assert rag.parse_citations("[2] then [1] then [2] again", hit_count=3) == [1, 0]


def test_context_is_numbered_from_one():
    """The model cites these numbers, so they have to match what it was shown."""
    context = rag.build_context([a_hit(text="first"), a_hit(text="second")])

    assert context.splitlines() == ["[1] first", "[2] second"]


class _FakeClient:
    """Stands in for the Gemini client, shaped like the bit we call."""

    def __init__(self, text: str):
        self._text = text

    @property
    def models(self):
        outer = self

        class Models:
            def generate_content(self, **_kwargs):
                class Response:
                    text = outer._text

                return Response()

        return Models()
