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
from app.services import model_store
from app.services.transcription import Segment

logger = logging.getLogger(__name__)
settings = get_settings()

# all-MiniLM-L6-v2 at a fixed commit, and only the files sentence-transformers
# reads (the repo also holds ONNX, OpenVINO, TensorFlow and Rust copies).
EMBEDDING_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
EMBEDDING_FILES = [
    "modules.json",
    "config_sentence_transformers.json",
    "sentence_bert_config.json",
    "config.json",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.txt",
    "1_Pooling/config.json",
]

_encoder = None
_client = None


def encoder_path() -> str:
    """
    A local folder holding the encoder, downloading it only if there's none.

    Loading by repo name made sentence-transformers ask Hugging Face for the
    newest files on every start, even with the model cached, so search went
    online after each restart (docs/LAUNCH_AUDIT.md P3). Now a cached copy is
    used as it is: the pinned commit, or the one an earlier version
    downloaded under the repo's main ref.
    """
    repo = settings.embedding_model
    return (
        model_store.cached_path(repo, EMBEDDING_REVISION, EMBEDDING_FILES)
        or model_store.cached_path(repo, None, EMBEDDING_FILES)
        or model_store.ensure(repo, revision=EMBEDDING_REVISION, allow_patterns=EMBEDDING_FILES)
    )


def get_encoder():
    global _encoder
    if _encoder is None:
        from sentence_transformers import SentenceTransformer

        path = encoder_path()
        logger.info("Loading embedding model %s from %s", settings.embedding_model, path)
        _encoder = SentenceTransformer(path, local_files_only=True)
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
