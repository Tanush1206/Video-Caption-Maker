"""
Caption embeddings and the ChromaDB vector store.

An embedding turns text into a vector positioned by *meaning*, so "how much
does it cost" lands near "what's the pricing" despite sharing no words. That
is what makes Milestone 9's search semantic rather than keyword matching.

Like the Whisper model, the encoder is loaded once per process and cached.
"""

import logging

import chromadb

from app.config import get_settings
from app.services.transcription import Segment

logger = logging.getLogger(__name__)
settings = get_settings()

_encoder = None
_client = None


def get_encoder():
    global _encoder
    if _encoder is None:
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model %s", settings.embedding_model)
        _encoder = SentenceTransformer(settings.embedding_model)
    return _encoder


def get_client():
    global _client
    if _client is None:
        # CHROMADB_URL is http://host:port; Chroma's client wants them apart.
        host = settings.chromadb_url.replace("http://", "").replace("https://", "")
        hostname, _, port = host.partition(":")
        _client = chromadb.HttpClient(host=hostname, port=int(port or 8000))
    return _client


def get_collection():
    return get_client().get_or_create_collection(
        name=settings.chroma_collection,
        # Cosine similarity is the right metric for sentence embeddings; the
        # default (L2) rates long and short texts differently for no good
        # reason once vectors aren't normalised.
        metadata={"hnsw:space": "cosine"},
    )


def index_captions(video_id: int, caption_ids: list[int], segments: list[Segment]) -> None:
    """
    Embed each caption and upsert it into the vector store.

    IDs are "{video_id}:{caption_id}" and upsert (not add) is used, so
    re-running the pipeline for a video overwrites its vectors instead of
    duplicating them.
    """
    if not segments:
        return

    texts = [segment.text for segment in segments]
    vectors = get_encoder().encode(texts, batch_size=32, show_progress_bar=False)

    get_collection().upsert(
        ids=[f"{video_id}:{caption_id}" for caption_id in caption_ids],
        embeddings=[vector.tolist() for vector in vectors],
        documents=texts,
        # Stored alongside so search results can be filtered by video and can
        # jump straight to a timestamp without a second database round-trip.
        metadatas=[
            {
                "video_id": video_id,
                "caption_id": caption_id,
                "start_ms": segment.start_ms,
                "end_ms": segment.end_ms,
            }
            for caption_id, segment in zip(caption_ids, segments, strict=True)
        ],
    )


def delete_video_vectors(video_id: int) -> None:
    """Drop a video's vectors. Called when the video is deleted or re-indexed."""
    try:
        get_collection().delete(where={"video_id": video_id})
    except Exception as exc:  # noqa: BLE001
        # A stale vector is a search-quality problem, not a correctness one,
        # and must not block deleting the video itself.
        logger.warning("Could not delete vectors for video %s: %s", video_id, exc)
