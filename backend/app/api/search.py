"""Semantic search and grounded question answering."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query, status

from app.dependencies import CurrentUser, DbSession
from app.schemas.search import (
    AskRequest,
    AskResponse,
    Citation,
    SearchResponse,
    SearchResult,
)
from app.services import app_settings, rag, search

logger = logging.getLogger(__name__)

router = APIRouter()


def _to_result(hit: search.SearchHit, titles: dict[int, str]) -> SearchResult:
    return SearchResult(
        video_id=hit.video_id,
        # A hit whose video vanished between retrieval and this lookup is a
        # stale vector, not a crash. Label it and move on.
        video_title=titles.get(hit.video_id, "Unknown video"),
        caption_id=hit.caption_id,
        start_ms=hit.start_ms,
        end_ms=hit.end_ms,
        text=hit.text,
        score=hit.score,
    )


async def _resolve_scope(db, user_id: int, video_id: int | None) -> list[int]:
    """
    Which videos this request may see.

    A requested video the user doesn't own resolves to an empty list, which
    returns no results — the same answer as a video with nothing matching, and
    deliberately so. A 404 here would confirm the id exists.
    """
    if video_id is not None:
        owned = await search.owned_video_ids(db, user_id, video_id)
        if not owned:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Video not found"
            )
        return owned

    return await search.owned_video_ids(db, user_id)


@router.get("/search", response_model=SearchResponse, tags=["search"])
async def semantic_search(
    user: CurrentUser,
    db: DbSession,
    q: str = Query(..., min_length=2, max_length=500),
    video_id: int | None = Query(default=None),
    limit: int = Query(default=search.DEFAULT_LIMIT, ge=1, le=50),
) -> SearchResponse:
    """
    Find captions by meaning rather than by keyword.

    Encoding the query loads the embedding model on this process's first
    search, which takes a couple of seconds. Run in a thread so that one slow
    call doesn't stall every other request on the event loop.
    """
    video_ids = await _resolve_scope(db, user.id, video_id)

    hits = await asyncio.to_thread(search.search_vectors, q, video_ids, limit)
    titles = await search.video_titles(db, [hit.video_id for hit in hits])

    return SearchResponse(
        query=q, results=[_to_result(hit, titles) for hit in hits], total=len(hits)
    )


@router.post("/ask", response_model=AskResponse, tags=["search"])
async def ask(payload: AskRequest, user: CurrentUser, db: DbSession) -> AskResponse:
    """
    Answer a question from the video's own transcript.

    Retrieval runs first and its results are returned whatever the model does,
    so a failed or refused answer still leaves the user with the passages —
    which is usually what they actually wanted.
    """
    video_ids = await _resolve_scope(db, user.id, payload.video_id)

    hits = await asyncio.to_thread(
        search.search_vectors, payload.question, video_ids, rag.CONTEXT_CHUNKS
    )
    api_key = await app_settings.gemini_key(db)
    answer = await asyncio.to_thread(rag.answer_question, payload.question, hits, api_key)
    titles = await search.video_titles(db, [hit.video_id for hit in hits])

    # Citations are resolved from *our* retrieved hits, not from anything the
    # model wrote. It cites an excerpt number; the timestamp attached to it is
    # ours. That is what stops a plausible-looking but invented timestamp.
    citations = [
        Citation(
            index=index + 1,
            video_id=hits[index].video_id,
            video_title=titles.get(hits[index].video_id, "Unknown video"),
            caption_id=hits[index].caption_id,
            start_ms=hits[index].start_ms,
            text=hits[index].text,
        )
        for index in answer.cited
    ]

    return AskResponse(
        question=payload.question,
        answer=answer.text,
        grounded=answer.grounded,
        citations=citations,
        results=[_to_result(hit, titles) for hit in hits],
    )
