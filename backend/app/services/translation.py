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

# The languages M2M100 can translate, as its own vocabulary names them
# (`__xx__` tokens in shared_vocabulary.json, identical in both revisions
# above). Every caption language must be in here: the core flow has to work
# offline, so a language only Gemini could deliver is not offered. A test
# holds LANGUAGES to it, and the loaded model is checked again at run time.
M2M100_LANGUAGES = frozenset(
    """
    af am ar ast az ba be bg bn br bs ca ceb cs cy da de el en es et fa ff
    fi fr fy ga gd gl gu ha he hi hr ht hu hy id ig ilo is it ja jv ka kk
    km kn ko lb lg ln lo lt lv mg mk ml mn mr ms my ne nl no ns oc or pa pl
    ps pt ro ru sd si sk sl so sq sr ss su sv sw ta th tl tn tr uk ur uz vi
    wo xh yi yo zh zu
    """.split()
)

# Captions per call to the local model. Progress is reported between chunks.
LOCAL_CHUNK = 32

# How many captions one sentence may span before it is translated in parts
# anyway, and how long it may get. Long enough for the two- and three-way
# splits the transcriber makes (captions are capped at ~84 characters), short
# enough that one runaway sentence cannot swallow a paragraph.
SENTENCE_MAX_CAPTIONS = 4
SENTENCE_MAX_CHARS = 400

# What ends a sentence, in the scripts captions arrive in: Latin and Cyrillic
# punctuation, the Devanagari danda (Hindi, Marathi) and double danda.
SENTENCE_END = (".", "!", "?", "…", "।", "॥", '"', "”", "»")


def sentence_groups(texts: list[str]) -> list[list[int]]:
    """
    Indices of `texts`, grouped into the sentences they belong to.

    The transcriber splits long sentences into captions of a readable length,
    so a caption is often a fragment — "until they are soft." after "First,
    chop two onions and fry them slowly". M2M100 translates one input at a
    time with no idea what came before, so each fragment came back as a
    sentence of its own: capitalised, sometimes with its own full stop, and
    with German or Dutch verbs moved to the wrong half. Grouping lets the
    model see the whole sentence.

    A group runs until a caption ends a sentence, or the limits above. Blank
    captions are never grouped; they are passed through on their own.
    """
    groups: list[list[int]] = []
    current: list[int] = []
    chars = 0
    for i, text in enumerate(texts):
        stripped = text.strip()
        if not stripped:
            if current:
                groups.append(current)
                current, chars = [], 0
            groups.append([i])
            continue
        current.append(i)
        chars += len(stripped)
        if (
            stripped.endswith(SENTENCE_END)
            or len(current) >= SENTENCE_MAX_CAPTIONS
            or chars >= SENTENCE_MAX_CHARS
        ):
            groups.append(current)
            current, chars = [], 0
    if current:
        groups.append(current)
    return groups


def split_like(translated: str, parts: list[str]) -> list[str] | None:
    """
    Split one translated sentence back into as many captions as it came from.

    Each caption gets a share of the words in proportion to how much of the
    source sentence it held, because that is what keeps the text on screen
    roughly in step with the speech its caption is timed to. A cut lands on
    a word boundary, and on one just after punctuation when there is one
    within two words of the ideal point — "a little salt," then "and a cup of
    water" rather than "a little" then "salt, and a cup".

    None when there are fewer words than captions: the caller then translates
    those captions one by one instead.
    """
    words = translated.split()
    count = len(parts)
    if count == 1:
        return [translated.strip()]
    if len(words) < count:
        return None

    lengths = [len(part.strip()) for part in parts]
    total = sum(lengths) or 1
    # Character offset at the end of each word, as a fraction of the whole.
    ends, running = [], 0
    for word in words:
        running += len(word) + 1
        ends.append(running)
    word_total = ends[-1]

    cuts: list[int] = []  # index of the word each part ends after
    share = 0
    for k in range(count - 1):
        share += lengths[k]
        ideal = share / total * word_total
        lowest = (cuts[-1] + 1) if cuts else 0
        highest = len(words) - (count - 1 - k) - 1  # leave a word for each later part
        best = min(range(lowest, highest + 1), key=lambda w: abs(ends[w] - ideal))
        for nearby in (best, best - 1, best + 1, best - 2, best + 2):
            if lowest <= nearby <= highest and words[nearby][-1] in ",;:.!?।":
                best = nearby
                break
        cuts.append(best)

    out, start = [], 0
    for cut in [*cuts, len(words) - 1]:
        out.append(" ".join(words[start : cut + 1]))
        start = cut + 1
    return out

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
    Translate with M2M100, a sentence at a time. Raises on failure.

    M2M100 needs to be told the source language, so this takes Whisper's
    detection. It has no notion of neighbouring lines, so captions that make
    up one sentence are joined, translated together, and split back over the
    same captions (`sentence_groups`, `split_like`). Each caption keeps its own
    timing; only the words move. A sentence whose translation will not split
    that many ways is translated caption by caption instead, as it always was.
    """
    if not source:
        raise UnsupportedLanguage("The spoken language is unknown")
    if source == target:
        return list(texts)

    translator, tokenizer = _load(on_download)
    for code in (source, target):
        if code not in _languages:
            raise UnsupportedLanguage(f"M2M100 cannot translate {code!r}")

    def decode(lines: list[str]) -> list[str]:
        return _decode(translator, tokenizer, lines, source, target)

    out = list(texts)
    groups = sentence_groups(texts)
    done = 0
    for start in range(0, len(groups), LOCAL_CHUNK):
        # Blank lines go straight through; the model would invent something.
        chunk = [g for g in groups[start : start + LOCAL_CHUNK] if texts[g[0]].strip()]
        joined = [" ".join(texts[i].strip() for i in group) for group in chunk]
        unsplit: list[int] = []
        for group, text in zip(chunk, decode(joined)):
            pieces = split_like(text, [texts[i] for i in group]) if text else None
            if pieces is None:
                unsplit.extend(group)
                continue
            for i, piece in zip(group, pieces):
                out[i] = piece or texts[i]
        for i, text in zip(unsplit, decode([texts[i] for i in unsplit])):
            out[i] = text or texts[i]
        done += sum(len(g) for g in groups[start : start + LOCAL_CHUNK])
        if on_progress:
            on_progress(min(100, round(done / len(texts) * 100)))
    return out


def _decode(translator, tokenizer, lines: list[str], source: str, target: str) -> list[str]:
    """
    One batch through the model, guarded against its two failure modes.

    On a language it has seen little of, M2M100 can run away — a 20-word
    caption came back as a 60-word news paragraph it remembered — or loop on a
    phrase. So the output may be at most three times the source's length in
    tokens (plus a little, for the scripts that need more pieces per word),
    and no four tokens may repeat.
    """
    if not lines:
        return []
    sources = [[f"__{source}__", *tokenizer.encode(line, out_type=str), "</s>"] for line in lines]
    longest = max(len(tokens) for tokens in sources)
    results = translator.translate_batch(
        sources,
        target_prefix=[[f"__{target}__"]] * len(sources),
        beam_size=4,
        max_batch_size=16,
        max_decoding_length=min(256, 3 * longest + 10),
        repetition_penalty=1.1,
        no_repeat_ngram_size=4,
    )
    # Drop the target-language token the output starts with.
    return [tokenizer.decode(result.hypotheses[0][1:]).strip() for result in results]


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
