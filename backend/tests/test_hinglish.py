"""
Hinglish (v1.0.9): the pinned downloads, their checks, and the conversions.

Nothing here touches the network. The real models were checked once by hand
against their reference implementations (PROGRESS.md, v1.0.9): Apex
converted byte for byte like the scratch conversion it was scored with, and
the fairseq-free IndicXlit gave fairseq's word for 352 of 353 words.
"""

import argparse
import json
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import hinglish, model_store


@pytest.fixture
def cache(tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    hub.mkdir()
    monkeypatch.setattr(model_store, "_cache_root", lambda: hub)
    hinglish.unload()
    yield tmp_path
    hinglish.unload()


def test_a_download_that_does_not_match_its_pin_is_refused_and_removed(cache, monkeypatch):
    snapshot = cache / "hub" / "models--ai4bharat--IndicXlit" / "snapshots" / "x"
    weights = snapshot / hinglish.XLIT_WEIGHTS
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"not the model")
    monkeypatch.setattr(model_store, "ensure", lambda *a, **k: str(snapshot))

    with pytest.raises(hinglish.ChecksumError, match="didn't match"):
        hinglish.xlit_dir()
    assert not (cache / "hub" / "models--ai4bharat--IndicXlit").exists()


def test_a_converted_model_is_reused_without_downloading(cache, monkeypatch):
    final = hinglish._converted("apex", hinglish.APEX_REVISION)
    final.mkdir(parents=True)
    (final / hinglish.MARKER).write_text(json.dumps({"revision": hinglish.APEX_REVISION}))
    monkeypatch.setattr(model_store, "ensure", lambda *a, **k: pytest.fail("downloaded again"))

    assert hinglish.apex_ready()
    assert hinglish.apex_dir() == str(final)


def test_a_conversion_from_another_revision_is_not_reused(cache):
    final = hinglish._converted("apex", hinglish.APEX_REVISION)
    final.mkdir(parents=True)
    (final / hinglish.MARKER).write_text(json.dumps({"revision": "0" * 40}))
    assert not hinglish.apex_ready()


def test_the_vocabulary_is_laid_out_as_fairseq_does(tmp_path):
    """Specials, the dictionary's symbols, filler to the embedding size, then the language tokens."""
    path = tmp_path / "dict.en.txt"
    path.write_text("a 10\nb 5\n", encoding="utf-8")
    vocab = hinglish._vocabulary(path, 4 + 2 + 2 + len(hinglish.XLIT_LANGS))
    assert vocab[:6] == ["<s>", "<blank>", "</s>", "<unk>", "a", "b"]
    assert vocab[6:8] == ["madeupword0000", "madeupword0001"]
    assert vocab[8] == "__en__" and vocab.index("__hi__") == 8 + hinglish.XLIT_LANGS.index("hi")


class FakeTranslator:
    def __init__(self):
        self.calls = []

    def translate_batch(self, batch, **options):
        self.calls.append(batch)
        table = {"aap": "आप", "file": "फाइल", "kaise": "कैसे", "ko": "को"}
        return [
            SimpleNamespace(hypotheses=[list(table["".join(tokens[1:])])]) for tokens in batch
        ]


def test_hinglish_becomes_devanagari_word_by_word_and_initialisms_stay(monkeypatch):
    """ "SRT" spelled out became "सर्त", which M2M100 read as "Circle". """
    fake = FakeTranslator()
    monkeypatch.setattr(hinglish, "_translator", lambda on_download: fake)

    out = hinglish.to_devanagari(["Aap SRT file kaise?", "file ko, 5 AI"])
    assert out == ["आप SRT फाइल कैसे?", "फाइल को, 5 AI"]
    # Each word once, lowercased, after the language token.
    [batch] = fake.calls
    assert sorted("".join(t[1:]) for t in batch) == ["aap", "file", "kaise", "ko"]
    assert all(t[0] == "__hi__" for t in batch)


def test_text_with_nothing_to_transliterate_skips_the_model(monkeypatch):
    monkeypatch.setattr(hinglish, "_translator", lambda on_download: pytest.fail("loaded"))
    assert hinglish.to_devanagari(["SRT, AI 5.", ""]) == ["SRT, AI 5.", ""]


def _tiny_checkpoint(path: Path, src_vocab: int, tgt_vocab: int, dim: int = 8, layers: int = 1) -> None:
    """A random checkpoint with IndicXlit's layout and settings, small enough to build in a test."""
    import torch

    torch.manual_seed(0)
    state = OrderedDict()

    def linear(name, out_dim, in_dim, bias=True):
        state[f"{name}.weight"] = torch.randn(out_dim, in_dim) * 0.1
        if bias:
            state[f"{name}.bias"] = torch.zeros(out_dim)

    def norm(name):
        state[f"{name}.weight"] = torch.ones(dim)
        state[f"{name}.bias"] = torch.zeros(dim)

    for side, vocab in (("encoder", src_vocab), ("decoder", tgt_vocab)):
        state[f"{side}.embed_tokens.weight"] = torch.randn(vocab, dim) * 0.1
        norm(f"{side}.layernorm_embedding")
        norm(f"{side}.layer_norm")
        for i in range(layers):
            p = f"{side}.layers.{i}"
            attentions = ["self_attn"] + (["encoder_attn"] if side == "decoder" else [])
            for attn in attentions:
                for proj in ("q_proj", "k_proj", "v_proj", "out_proj"):
                    linear(f"{p}.{attn}.{proj}", dim, dim)
                norm(f"{p}.{attn}_layer_norm")
            linear(f"{p}.fc1", dim * 2, dim)
            linear(f"{p}.fc2", dim, dim * 2)
            norm(f"{p}.final_layer_norm")
    linear("decoder.output_projection", tgt_vocab, dim, bias=False)

    cfg = argparse.Namespace(
        arch="transformer", activation_fn="gelu", encoder_learned_pos=False,
        encoder_layers=layers, decoder_layers=layers, encoder_attention_heads=2,
        encoder_normalize_before=True, layernorm_embedding=True, no_scale_embedding=False,
        encoder_embed_dim=dim, max_source_positions=32,
    )
    torch.save({"cfg": {"model": cfg}, "model": state, "args": None}, path)


def test_an_indicxlit_shaped_checkpoint_converts_without_fairseq_and_runs(tmp_path):
    import ctranslate2

    langs = len(hinglish.XLIT_LANGS)
    (tmp_path / "dict.en.txt").write_text("a 1\nb 1\n", encoding="utf-8")
    (tmp_path / "dict.hi.txt").write_text("क 1\nख 1\n", encoding="utf-8")
    checkpoint = tmp_path / "tiny.pt"
    _tiny_checkpoint(checkpoint, src_vocab=6 + langs, tgt_vocab=6 + langs)

    out = tmp_path / "ct2"
    hinglish.convert_xlit(checkpoint, tmp_path / "dict.en.txt", tmp_path / "dict.hi.txt", out)

    source = json.loads((out / "source_vocabulary.json").read_text(encoding="utf-8"))
    assert "__hi__" in source and source[4:6] == ["a", "b"]
    translator = ctranslate2.Translator(str(out), device="cpu", compute_type="float32")
    [result] = translator.translate_batch([["__hi__", "a", "b"]], beam_size=1, max_decoding_length=4)
    assert result.hypotheses[0] is not None


def test_the_image_can_convert_the_hinglish_model():
    """
    transformers isn't named in pyproject.toml: it comes with
    sentence-transformers, and naming it would change the dependency layer
    every update downloads again (2.2 GB on CUDA the last time it changed).
    This fails if it, or CTranslate2's converter for it, ever goes missing.
    """
    import transformers  # noqa: F401
    from ctranslate2.converters import TransformersConverter  # noqa: F401
    from ctranslate2.converters import fairseq  # noqa: F401
