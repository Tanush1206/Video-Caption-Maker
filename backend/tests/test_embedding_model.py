"""
Search loads its model from the local cache and goes online only to fetch a
missing one (services/embeddings.py; docs/LAUNCH_AUDIT.md P3).
"""

import sys
import types

import pytest

from app.services import embeddings


@pytest.fixture
def loaded(monkeypatch):
    """Record what SentenceTransformer is asked to load, without loading anything."""
    calls = []

    class FakeSentenceTransformer:
        def __init__(self, path, **kwargs):
            calls.append((path, kwargs))

    monkeypatch.setitem(
        sys.modules, "sentence_transformers", types.SimpleNamespace(SentenceTransformer=FakeSentenceTransformer)
    )
    monkeypatch.setattr(embeddings, "_encoder", None)
    return calls


def test_a_cached_model_is_used_without_going_online(monkeypatch, loaded):
    monkeypatch.setattr(
        embeddings.model_store, "cached_path",
        lambda repo, revision, files: "/models/minilm" if revision == embeddings.EMBEDDING_REVISION else None,
    )
    monkeypatch.setattr(
        embeddings.model_store, "ensure", lambda *a, **k: pytest.fail("downloaded although cached")
    )

    embeddings.get_encoder()

    assert loaded == [("/models/minilm", {"local_files_only": True})]


def test_a_copy_an_earlier_version_downloaded_is_used_as_it_is(monkeypatch, loaded):
    """Before 1.1.1 the model came by repo name, so it sits under the main ref."""
    monkeypatch.setattr(
        embeddings.model_store, "cached_path",
        lambda repo, revision, files: "/models/minilm-main" if revision is None else None,
    )
    monkeypatch.setattr(
        embeddings.model_store, "ensure", lambda *a, **k: pytest.fail("downloaded although cached")
    )

    embeddings.get_encoder()

    assert loaded[0][0] == "/models/minilm-main"


def test_only_a_missing_model_is_downloaded_at_the_pinned_commit(monkeypatch, loaded):
    asked = {}
    monkeypatch.setattr(embeddings.model_store, "cached_path", lambda *a: None)

    def ensure(repo, *, revision, allow_patterns, on_progress=None):
        asked.update(repo=repo, revision=revision, files=allow_patterns)
        return "/models/fresh"

    monkeypatch.setattr(embeddings.model_store, "ensure", ensure)

    embeddings.get_encoder()

    assert asked["revision"] == embeddings.EMBEDDING_REVISION
    assert "model.safetensors" in asked["files"] and not any("onnx" in f for f in asked["files"])
    assert loaded[0][0] == "/models/fresh"
