"""
Hindi written in Roman script ("Hinglish"): the speech model, and the
transliterator that turns its text back into Devanagari for translation.

Both download on first use from their original Hugging Face repos, pinned
to one commit and checked against the sha256 Hugging Face publishes for the
weights, then are converted to CTranslate2 on this machine. Nothing here is
baked into an image, and nothing is fetched from anywhere the pin doesn't
name.

Measured on the Hinglish tutorial (PROGRESS.md, v1.0.9): Oriserve's Apex
fine-tune of large-v3-turbo writes the talk at 31% WER and 65 of 73 English
words in English spelling, against large-v3's 74% and 12 of 73, in a third of
turbo's time. M2M100 can't translate Roman Hinglish (it copies it through, or
invents Marathi), so translations go through IndicXlit's Devanagari first.
"""

import argparse
import hashlib
import json
import logging
import math
import os
import re
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

from app.services import model_store

logger = logging.getLogger(__name__)

# ── The speech model ──────────────────────────────────────────────────────

APEX_REPO = "Oriserve/Whisper-Hindi2Hinglish-Apex"
APEX_REVISION = "f3214eed20b4e4d4144e739982d911f87b9cb223"
APEX_WEIGHTS = "model.safetensors"
APEX_SHA256 = "5560830fe8fa09b8cdf1b5926d0cc39a2586eadaad685d809e156432c4ebca80"
# The weights and the small files the converter reads; the repo's sample
# audio is left behind.
APEX_FILES = [APEX_WEIGHTS, "*.json", "*.txt"]
APEX_DOWNLOAD_BYTES = 1_625_000_000
# The card ships no alignment heads, and faster-whisper's word timestamps
# need them; the fine-tune keeps its base's architecture, so its base's
# (openai/whisper-large-v3-turbo, generation_config.json). Without them
# CTranslate2 falls back to every head of the last half of the decoder.
APEX_ALIGNMENT_HEADS = [[2, 4], [2, 11], [3, 3], [3, 6], [3, 11], [3, 14]]
# Apex writes Hinglish under Whisper's English token, as its card says.
APEX_LANGUAGE = "en"

# ── The transliterator ────────────────────────────────────────────────────

XLIT_REPO = "ai4bharat/IndicXlit"
XLIT_REVISION = "e7049fe725b11c0a187d42edeb2f56aa1ffee5fd"
XLIT_DIR = "indicxlit-en-indic-v1.0"
XLIT_WEIGHTS = f"{XLIT_DIR}/transformer/indicxlit.pt"
XLIT_SHA256 = "2f03fe0dfb2edc40f3c11f9293c4feda4fa8ed5366fec2981391606f224a09f7"
XLIT_FILES = [XLIT_WEIGHTS, f"{XLIT_DIR}/corpus-bin/dict.en.txt", f"{XLIT_DIR}/corpus-bin/dict.hi.txt"]
# fairseq's multilingual task appends one token per language of the model's
# list, in this order, after the dictionary's symbols (IndicXlit's lang_list).
XLIT_LANGS = ["en", "as", "bn", "brx", "gom", "gu", "hi", "kn", "ks", "mai", "ml", "mni", "mr",
              "ne", "or", "pa", "sa", "sd", "si", "ta", "te", "ur"]
XLIT_SPECIALS = ["<s>", "<pad>", "</s>", "<unk>"]

# Words the transliterator leaves alone: all capitals (SRT, AI) are
# initialisms, and spelled out letter by letter they become a word M2M100
# reads as something else ("SRT" -> "सर्त" -> "Circle").
LATIN_WORD = re.compile(r"[A-Za-z]+")

# A converted model is complete when this file is in its folder, written
# last, naming what it was converted from.
MARKER = "vcm-source.json"


class ChecksumError(model_store.ModelDownloadError):
    """The download isn't the file the pin names."""


def _converted_root() -> Path:
    # Next to Hugging Face's own cache, on the same models volume the API and
    # the worker share, so the API can tell whether a download is still due.
    return model_store._cache_root().parent / "vcm-converted"


def _converted(name: str, revision: str) -> Path:
    return _converted_root() / f"{name}-{revision[:12]}"


def _ready(path: Path, revision: str) -> bool:
    try:
        return json.loads((path / MARKER).read_text())["revision"] == revision
    except (OSError, ValueError, KeyError):
        return False


def apex_ready() -> bool:
    """Whether the Hinglish speech model is already on this machine."""
    return _ready(_converted("apex", APEX_REVISION), APEX_REVISION)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _verified(repo: str, snapshot: str, relative: str, expected: str) -> Path:
    path = Path(snapshot) / relative
    actual = sha256_of(path)
    if actual != expected:
        # Removed, so the next try downloads it again instead of trusting it.
        shutil.rmtree(model_store._repo_dir(repo), ignore_errors=True)
        raise ChecksumError(
            "The downloaded model didn't match the expected file, so it wasn't used. "
            "Try again; if it happens again, the download is being altered on the way."
        )
    return path


def _finish(work: Path, final: Path, revision: str, repo: str, sha256: str) -> None:
    (work / MARKER).write_text(json.dumps({"repo": repo, "revision": revision, "sha256": sha256}))
    shutil.rmtree(final, ignore_errors=True)
    work.rename(final)


def apex_dir(on_download: model_store.Progress | None = None) -> str:
    """The converted Hinglish speech model, downloading and converting it first if needed."""
    final = _converted("apex", APEX_REVISION)
    if _ready(final, APEX_REVISION):
        return str(final)

    snapshot = model_store.ensure(
        APEX_REPO, revision=APEX_REVISION, allow_patterns=APEX_FILES, on_progress=on_download
    )
    _verified(APEX_REPO, snapshot, APEX_WEIGHTS, APEX_SHA256)
    logger.info("Converting %s for CTranslate2", APEX_REPO)

    from ctranslate2.converters import TransformersConverter

    final.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=final.parent) as staging:
        # The snapshot is Hugging Face's cache (read-only links into its blob
        # store), so the alignment heads go into a copy of the small files,
        # with the weights linked rather than copied.
        source = Path(staging) / "source"
        source.mkdir()
        for item in Path(snapshot).iterdir():
            if item.name == APEX_WEIGHTS:
                (source / item.name).symlink_to(item.resolve())
            elif item.is_file():
                shutil.copyfile(item, source / item.name)
        generation = json.loads((source / "generation_config.json").read_text())
        generation["alignment_heads"] = APEX_ALIGNMENT_HEADS
        (source / "generation_config.json").write_text(json.dumps(generation))

        work = Path(staging) / "model"
        TransformersConverter(
            str(source), copy_files=["tokenizer.json", "preprocessor_config.json"]
        ).convert(str(work), quantization="float16")
        _finish(work, final, APEX_REVISION, APEX_REPO, APEX_SHA256)

    # The converted model is all that is read from here on; the original
    # weights would be another 1.6 GB on disk for nothing.
    shutil.rmtree(model_store._repo_dir(APEX_REPO), ignore_errors=True)
    return str(final)


# ── IndicXlit without fairseq ─────────────────────────────────────────────


def _vocabulary(dict_path: Path, size: int) -> list[str]:
    """fairseq's dictionary: specials, the file's symbols, padding to `size`, language tokens."""
    symbols = XLIT_SPECIALS + [
        line.rsplit(" ", 1)[0] for line in dict_path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    langs = [f"__{code}__" for code in XLIT_LANGS]
    filler = size - len(symbols) - len(langs)
    if filler < 0:
        raise ValueError("IndicXlit's dictionary is larger than its embeddings")
    vocab = symbols + [f"madeupword{i:04d}" for i in range(filler)] + langs
    return ["<blank>" if token == "<pad>" else token for token in vocab]


def _modules(state: dict, prefix: str) -> SimpleNamespace:
    """The checkpoint's tensors as nested attributes, the shape CTranslate2's fairseq setters read."""
    root = SimpleNamespace()
    for key, value in state.items():
        if not key.startswith(prefix):
            continue
        node, parts = root, key[len(prefix):].split(".")
        for part in parts[:-1]:
            child = node.__dict__.setdefault(part, SimpleNamespace())
            node = child
        setattr(node, parts[-1], value.float())
    return root


def _sinusoidal(num: int, dim: int, padding_idx: int):
    """fairseq's SinusoidalPositionalEmbedding table: the sine half, then the cosine half."""
    import torch

    half = dim // 2
    freqs = torch.exp(torch.arange(half, dtype=torch.float) * -(math.log(10000) / (half - 1)))
    angles = torch.arange(num, dtype=torch.float).unsqueeze(1) * freqs.unsqueeze(0)
    table = torch.cat([torch.sin(angles), torch.cos(angles)], dim=1)
    table[padding_idx, :] = 0
    return table


def _side(state: dict, name: str, cfg, layers: int) -> SimpleNamespace:
    module = _modules(state, f"{name}.")
    module.layers = [getattr(module.layers, str(i)) for i in range(layers)]
    module.embed_scale = 1.0 if cfg.no_scale_embedding else math.sqrt(cfg.encoder_embed_dim)
    # padding_idx 1 is fairseq's <pad>; positions start after it.
    module.embed_positions = SimpleNamespace(
        weights=_sinusoidal(cfg.max_source_positions + 2, cfg.encoder_embed_dim, 1), padding_idx=1
    )
    module.layer_norm = getattr(module, "layer_norm", None)
    if name == "decoder":
        module.project_in_dim = None
        module.project_out_dim = None
        module.output_projection.bias = None
    return module


def convert_xlit(checkpoint: Path, source_dict: Path, target_dict: Path, out: Path) -> None:
    """
    IndicXlit's fairseq checkpoint to a CTranslate2 model, with torch alone.

    The checkpoint holds plain tensors and an argparse.Namespace of settings,
    so fairseq (unmaintained, and no wheels for this Python) isn't needed to
    read it: the weights are laid out the way CTranslate2's own fairseq
    converter expects modules to be, and its setters do the rest. Checked
    against fairseq: 352 of the 353 distinct words of the Hinglish tutorial
    came out the same, the other only through the package's own handling of
    an apostrophe, which this module doesn't pass in.
    """
    import torch
    from ctranslate2.converters import fairseq as ct2_fairseq
    from ctranslate2.specs import common_spec, transformer_spec

    with torch.serialization.safe_globals([argparse.Namespace]):
        checkpoint_data = torch.load(checkpoint, map_location="cpu", weights_only=True)
    cfg, state = checkpoint_data["cfg"]["model"], checkpoint_data["model"]
    if cfg.arch != "transformer" or cfg.activation_fn != "gelu" or cfg.encoder_learned_pos:
        raise ValueError("Not the IndicXlit model this converter was written for")

    spec = transformer_spec.TransformerSpec.from_config(
        (cfg.encoder_layers, cfg.decoder_layers),
        cfg.encoder_attention_heads,
        pre_norm=cfg.encoder_normalize_before,
        activation=common_spec.Activation.GELU,
        layernorm_embedding=cfg.layernorm_embedding,
    )
    ct2_fairseq.set_transformer_encoder(spec.encoder, _side(state, "encoder", cfg, cfg.encoder_layers))
    ct2_fairseq.set_transformer_decoder(spec.decoder, _side(state, "decoder", cfg, cfg.decoder_layers))
    spec.register_source_vocabulary(_vocabulary(source_dict, state["encoder.embed_tokens.weight"].shape[0]))
    spec.register_target_vocabulary(_vocabulary(target_dict, state["decoder.embed_tokens.weight"].shape[0]))
    # fairseq starts decoding from </s> and ends the source with it.
    spec.config.decoder_start_token = spec.config.eos_token
    spec.config.add_source_eos = True
    spec.validate()
    spec.optimize(quantization="float16")
    out.mkdir(parents=True, exist_ok=True)
    spec.save(str(out))


def xlit_dir(on_download: model_store.Progress | None = None) -> str:
    """The converted transliterator, downloading and converting it first if needed."""
    final = _converted("indicxlit", XLIT_REVISION)
    if _ready(final, XLIT_REVISION):
        return str(final)

    snapshot = model_store.ensure(
        XLIT_REPO, revision=XLIT_REVISION, allow_patterns=XLIT_FILES, on_progress=on_download
    )
    checkpoint = _verified(XLIT_REPO, snapshot, XLIT_WEIGHTS, XLIT_SHA256)
    logger.info("Converting %s for CTranslate2", XLIT_REPO)
    corpus = Path(snapshot) / XLIT_DIR / "corpus-bin"
    final.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=final.parent) as staging:
        work = Path(staging) / "model"
        convert_xlit(checkpoint, corpus / "dict.en.txt", corpus / "dict.hi.txt", work)
        _finish(work, final, XLIT_REVISION, XLIT_REPO, XLIT_SHA256)
    shutil.rmtree(model_store._repo_dir(XLIT_REPO), ignore_errors=True)
    return str(final)


_xlit = None


def unload() -> None:
    global _xlit
    _xlit = None


def _translator(on_download: model_store.Progress | None):
    global _xlit
    if _xlit is None:
        import ctranslate2

        # float32: the model is 23 MB, a whole video's words take a fraction
        # of a second, and int8 changed 4 of 353 words ("hain" -> "हैन").
        _xlit = ctranslate2.Translator(
            xlit_dir(on_download), device="cpu", compute_type="float32",
            inter_threads=1, intra_threads=max(1, min(4, os.cpu_count() or 1)),
        )
    return _xlit


def keeps(word: str) -> bool:
    """A Latin word the transliterator leaves as it is: an initialism (SRT, AI)."""
    return len(word) > 1 and word.isupper()


def to_devanagari(
    texts: list[str], on_download: model_store.Progress | None = None
) -> list[str]:
    """
    Roman Hinglish to Devanagari, word by word, everything else untouched.

    Each distinct word is transliterated once, then put back where it was:
    punctuation, digits and initialisms stay as they are.
    """
    words = sorted({w for text in texts for w in LATIN_WORD.findall(text) if not keeps(w)})
    if not words:
        return list(texts)
    translator = _translator(on_download)
    results = translator.translate_batch(
        [["__hi__", *word.lower()] for word in words], beam_size=4, max_decoding_length=64,
    )
    table = {word: "".join(result.hypotheses[0]) or word for word, result in zip(words, results)}
    return [
        LATIN_WORD.sub(lambda m: m.group(0) if keeps(m.group(0)) else table[m.group(0)], text)
        for text in texts
    ]
