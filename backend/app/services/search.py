"""
Semantic search over caption embeddings.

Keyword search finds the words you typed. This finds the passage that *means*
what you typed — "how much does it cost" matches "the pricing works out at",
which shares no words with it at all. That is the entire reason the vectors
from Milestone 4 exist.

The security-critical part of this module is that ChromaDB has no idea who
owns anything. Every query here is scoped to video ids the caller has already
been proven to own, resolved from Postgres, and passed as a hard filter.
"""

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video import Video
from app.services import embeddings

logger = logging.getLogger(__name__)

# Cosine *distance*, so lower is more similar: 0 is identical, 1 is unrelated.
# Above this a hit is noise, and returning it would be worse than returning
# nothing — it is what turns "I don't know" into a confident wrong answer.
MAX_DISTANCE = 0.75

DEFAULT_LIMIT = 10


@dataclass
class SearchHit:
    video_id: int
    caption_id: int
    start_ms: int
    end_ms: int
    text: str
    distance: float

    @property
    def score(self) -> float:
        """Similarity in 0..1, which reads better in an API than a distance."""
        return round(max(0.0, 1.0 - self.distance), 4)


async def owned_video_ids(
    db: AsyncSession, owner_id: int, video_id: int | None = None
) -> list[int]:
    """
    The videos this user may search.

    Resolved from Postgres rather than trusted from the request, because the
    vector store cannot enforce this: a caller who could choose the filter
    could read every transcript in the database.
    """
    query = select(Video.id).where(Video.owner_id == owner_id)
    if video_id is not None:
        query = query.where(Video.id == video_id)

    return list((await db.execute(query)).scalars().all())


def search_vectors(query: str, video_ids: list[int], limit: int) -> list[SearchHit]:
    """
    Nearest captions to `query`, restricted to `video_ids`.

    Synchronous and blocking: encoding one short query is a few milliseconds
    once the model is warm. The *first* call in a process pays for loading the
    encoder, which is why callers run this off the event loop.
    """
    if not query.strip() or not video_ids:
        return []

    vector = embeddings.get_encoder().encode([query])[0].tolist()

    result = embeddings.get_collection().query(
        query_embeddings=[vector],
        n_results=limit,
        # $in rather than a loop of per-video queries: one HNSW traversal with
        # a metadata filter, instead of N round-trips to merge by hand.
        where={"video_id": {"$in": video_ids}},
        include=["documents", "metadatas", "distances"],
    )

    # Chroma returns one list per query embedding; we only ever send one.
    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]

    hits = [
        SearchHit(
            video_id=int(meta["video_id"]),
            caption_id=int(meta["caption_id"]),
            start_ms=int(meta["start_ms"]),
            end_ms=int(meta["end_ms"]),
            text=document,
            distance=float(distance),
        )
        for document, meta, distance in zip(documents, metadatas, distances, strict=True)
    ]

    return [hit for hit in hits if hit.distance <= MAX_DISTANCE]
