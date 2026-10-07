"""
Translating captions into a chosen language.

Whisper can translate, but only ever **into English** — `task="translate"` has
no target parameter. So English captions come free in the transcription pass,
and every other language needs this: transcribe first, translate the text
after, and keep the timings exactly as Whisper produced them.

Two engines, and the local one is the default:

  * **M2M100** (Meta, MIT licence), run by CTranslate2 in int8 on this
    machine. 1.2B parameters with 12GB of RAM or more, 418M below that. No
    network, no key, no quota.
  * **Gemini**, when a key has been pasted into Settings. Better at idiom and
    at keeping a fragment a fragment, because it sees 25 neighbouring lines at
    once where M2M100 sees one. Any failure — no network, quota, a bad key —
    falls back to M2M100 rather than failing the job, and says so.

Timings are never touched here. A translated line takes a different number of
words than the original, and any attempt to re-time it would be guesswork
against audio this module never sees.
"""

import gc
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.config import get_settings
from app.services import model_store
from app.services.languages import LANGUAGES

logger = logging.getLogger(__name__)
settings = get_settings()

# How many captions go in one request.
#
# Small enough that a failure loses a little work and the output stays inside
# the token cap, large enough that a 350-caption transcript is a handful of
# calls rather than 350. Batching also gives the model neighbouring lines as
# context, which is most of what makes a caption translate sensibly.
BATCH_SIZE = 25

# Transient failures from this API are routine: 503 "high demand" and 429
# quota are both temporary and both were seen on the first live run.
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2

PROMPT = """\
Translate each line into {language}.

Rules:
- Return ONLY a JSON array of strings, the same length and order as the input.
- Translate line by line. Do not merge, split, reorder or drop lines.
- These are video captions, often mid-sentence. Translate the fragment as it
  is; do not complete it or add words that are not there.
- If a line is already in {language}, return it unchanged.
- If a line cannot be translated, return it unchanged rather than omitting it.

Input (JSON array of {count} strings):
{lines}"""


GEMINI_FALLBACK_NOTICE = (
    "Gemini couldn't be used, so the captions were translated on this computer instead."
)

# Pinned to a commit: these are third-party conversions of Meta's MIT-licensed
# checkpoints, and a pinned revision cannot change under an installed app.
# CTranslate2's model.bin is a plain weights format, not a pickle, so loading
# it cannot execute code.
M2M100_MODELS: dict[str, tuple[str, str]] = {
    "m2m100_1.2B": ("jncraton/m2m100_1.2B-ct2-int8", "e50078df6be13a88592b70ea42f4d74c2082e448"),
    "m2m100_418M": ("jncraton/m2m100_418M-ct2-int8", "7c1b2620a4e58dacecbd8bf89cfd6da7eb9eb7b0"),
}
M2M100_FILES = ["model.bin", "config.json", "shared_vocabulary.json", "sentencepiece.bpe.model"]
M2M100_SIZES_MB = {"m2m100_1.2B": 1260, "m2m100_418M": 500}

# Captions per call to the local model. Progress is reported between chunks.
LOCAL_CHUNK = 32

_translator = None
_tokenizer = None
_languages: set[str] = set()
_loaded_key: tuple[str, str, str] | None = None


@dataclass
class Translation:
    texts: list[str]
    engine: str  # "gemini" or "local"
    notice: str | None = None


def translate_texts(
    texts: list[str],
    target: str,
    *,
    source: str | None = None,
    api_key: str | None = None,
    on_progress: Callable[[int], None] | None = None,
    on_download: model_store.Progress | None = None,
) -> Translation | None:
    """
    Translate caption texts into `target`, preserving count and order.

    Gemini first if there is a key, the local model otherwise or if Gemini
    fails. Returns None only if neither could produce an aligned result; the
    caller keeps the original captions then. A transcript in the wrong
    language is disappointing, and one whose lines have been silently shuffled
    against their timings is broken.

    A model that cannot be downloaded raises ModelDownloadError, whose message
    is meant for the user.
    """
    if not texts:
        return Translation(texts=[], engine="local")

    if LANGUAGES.get(target) is None:
        logger.error("Refusing to translate into unknown language %r", target)
        return None

    notice = None
    if api_key:
        translated = translate_with_gemini(texts, target, api_key)
        if translated is not None:
            return Translation(texts=translated, engine="gemini")
        notice = GEMINI_FALLBACK_NOTICE

    try:
        translated = translate_locally(
            texts, target, source=source, on_progress=on_progress, on_download=on_download
        )
    except model_store.ModelDownloadError:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("Local translation into %s failed", target)
        return None
    return Translation(texts=translated, engine="local", notice=notice)


def translate_with_gemini(texts: list[str], target: str, api_key: str) -> list[str] | None:
    """The Gemini path alone: aligned translations, or None on any failure."""
    language = LANGUAGES.get(target)
    if language is None:
        return None

    out: list[str] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        translated = _translate_batch(batch, language, api_key)
        if translated is None:
            return None
        out.extend(translated)
    return out


# ── Local: M2M100 through CTranslate2 ──────────────────────────────────────


class UnsupportedLanguage(ValueError):
    pass


def unload() -> None:
    """Free the translator, so Whisper can have the memory back."""
    global _translator, _tokenizer, _loaded_key
    if _translator is None:
        return
    _translator = None
    _tokenizer = None
    _loaded_key = None
    gc.collect()
    logger.info("Unloaded translator")


def _load(on_download: model_store.Progress | None = None):
    global _translator, _tokenizer, _languages, _loaded_key

    from app.services import hardware

    profile = hardware.translator_profile(hardware.detect())
    key = (profile.model, profile.device, profile.compute_type)
    if _translator is not None and _loaded_key == key:
        return _translator, _tokenizer

    # Never alongside Whisper: on an 8GB laptop the two together do not fit.
    from app.services import transcription

    transcription.unload_model()
    unload()

    if profile.model not in M2M100_MODELS:
        raise ValueError(f"Unknown translation model {profile.model!r}")
    repo, revision = M2M100_MODELS[profile.model]
    path = model_store.ensure(
        repo, revision=revision, allow_patterns=M2M100_FILES, on_progress=on_download
    )

    import ctranslate2
    import sentencepiece

    logger.info("Loading %s on %s (%s)", profile.model, profile.device, profile.compute_type)
    try:
        translator = ctranslate2.Translator(
            path, device=profile.device, compute_type=profile.compute_type
        )
    except (RuntimeError, ValueError) as exc:
        if profile.device != "cuda":
            raise
        logger.warning("Translator could not use the GPU (%s); using the CPU", exc)
        translator = ctranslate2.Translator(path, device="cpu", compute_type="int8")
        key = (profile.model, "cpu", "int8")

    with open(f"{path}/shared_vocabulary.json", encoding="utf-8") as handle:
        vocabulary = json.load(handle)
    _languages = {
        token[2:-2] for token in vocabulary if token.startswith("__") and token.endswith("__")
    }
    _tokenizer = sentencepiece.SentencePieceProcessor(
        model_file=f"{path}/sentencepiece.bpe.model"
    )
    _translator = translator
    _loaded_key = key
    return _translator, _tokenizer


def translate_locally(
    texts: list[str],
    target: str,
    *,
    source: str | None,
    on_progress: Callable[[int], None] | None = None,
    on_download: model_store.Progress | None = None,
) -> list[str]:
    """
    Translate line by line with M2M100. Raises on failure.

    M2M100 needs to be told the source language, so this takes Whisper's
    detection. Each caption is translated on its own — the model has no
    notion of neighbouring lines, which is the main thing Gemini does better.
    """
    if not source:
        raise UnsupportedLanguage("The spoken language is unknown")
    if source == target:
        return list(texts)

    translator, tokenizer = _load(on_download)
    for code in (source, target):
        if code not in _languages:
            raise UnsupportedLanguage(f"M2M100 cannot translate {code!r}")

    out: list[str] = []
    for start in range(0, len(texts), LOCAL_CHUNK):
        chunk = texts[start : start + LOCAL_CHUNK]
        # Blank lines go straight through; the model would invent something.
        indices = [i for i, text in enumerate(chunk) if text.strip()]
        sources = [
            [f"__{source}__", *tokenizer.encode(chunk[i], out_type=str), "</s>"] for i in indices
        ]
        results = (
            translator.translate_batch(
                sources,
                target_prefix=[[f"__{target}__"]] * len(sources),
                beam_size=4,
                max_batch_size=16,
                # Captions are a line or two. A runaway decode on a garbled
                # line should stop near the length of a caption, not at 1024.
                max_decoding_length=200,
                repetition_penalty=1.1,
            )
            if sources
            else []
        )
        translated = list(chunk)
        for i, result in zip(indices, results):
            tokens = result.hypotheses[0][1:]  # drop the target-language token
            text = tokenizer.decode(tokens).strip()
            translated[i] = text or chunk[i]
        out.extend(translated)
        if on_progress:
            on_progress(min(100, round(len(out) / len(texts) * 100)))
    return out


# ── Gemini ─────────────────────────────────────────────────────────────────


def _translate_batch(batch: list[str], language: str, api_key: str) -> list[str] | None:
    """
    One request, retried on the transient failures this API actually returns.

    503 "high demand" and 429 quota are both routine and both temporary — one
    was hit on the very first live run of this code, on the fourth of four
    languages. Without a retry a single blip discards the whole translation,
    and a full transcript is many batches, so the chance of at least one blip
    grows with the length of the video. Retrying is what makes the feature work
    on a long file rather than only on a short one.
    """
    for attempt in range(MAX_ATTEMPTS):
        result = _attempt_batch(batch, language, api_key)
        if result is not None:
            return result
        if attempt < MAX_ATTEMPTS - 1:
            # Exponential, because the failure being retried is server-side
            # congestion — retrying hard makes it worse for everyone.
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))

    return None


def _attempt_batch(batch: list[str], language: str, api_key: str) -> list[str] | None:
    from google.genai import types

    from app.services.rag import get_client

    prompt = PROMPT.format(
        language=language,
        count=len(batch),
        lines=json.dumps(batch, ensure_ascii=False),
    )

    try:
        response = get_client(api_key).models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                # Translation is a conversion, not a creative task.
                temperature=0.1,
                # JSON directly, rather than parsing prose around an array.
                response_mime_type="application/json",
                # Generous, and for the same reason the answer service's is:
                # `gemini-flash-latest` is a thinking model and reasoning
                # tokens are charged against this cap. Non-Latin scripts also
                # cost several tokens per character, so a batch of Hindi can be
                # multiples of its English equivalent.
                max_output_tokens=8000,
                thinking_config=types.ThinkingConfig(thinking_level="low"),
            ),
        )
        payload = json.loads((response.text or "").strip())
    except Exception as exc:  # noqa: BLE001
        logger.error("Caption translation failed: %s", exc)
        return None

    if not isinstance(payload, list) or len(payload) != len(batch):
        # The one failure that must never pass silently: a short or reordered
        # array would pair every following caption with the wrong timing.
        logger.error(
            "Translation returned %s items for a batch of %d",
            len(payload) if isinstance(payload, list) else type(payload).__name__,
            len(batch),
        )
        return None

    # A model that returns a number or null for a line should not blank the
    # caption; fall back to the original text for that entry alone.
    return [
        item.strip() if isinstance(item, str) and item.strip() else original
        for item, original in zip(payload, batch)
    ]
