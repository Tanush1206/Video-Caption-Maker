"""
Translating captions into a chosen language.

Whisper can translate, but only ever **into English** — `task="translate"` has
no target parameter. So English captions come free in the transcription pass,
and every other language needs this: transcribe first, translate the text
after, and keep the timings exactly as Whisper produced them.

Timings are never touched here. A translated line takes a different number of
words than the original, and any attempt to re-time it would be guesswork
against audio this module never sees.
"""

import json
import logging
import time

from app.config import get_settings
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


def translate_texts(texts: list[str], target: str) -> list[str] | None:
    """
    Translate caption texts into `target`, preserving count and order.

    Returns None if translation is unavailable or produced something that does
    not line up. The caller keeps the original captions in that case: a
    transcript in the wrong language is disappointing, and a transcript whose
    lines have been silently shuffled against their timings is broken.
    """
    if not texts:
        return []

    language = LANGUAGES.get(target)
    if language is None:
        logger.error("Refusing to translate into unknown language %r", target)
        return None

    if not settings.gemini_api_key:
        logger.error("No Gemini API key, cannot translate captions")
        return None

    out: list[str] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        translated = _translate_batch(batch, language)
        if translated is None:
            return None
        out.extend(translated)

    return out


def _translate_batch(batch: list[str], language: str) -> list[str] | None:
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
        result = _attempt_batch(batch, language)
        if result is not None:
            return result
        if attempt < MAX_ATTEMPTS - 1:
            # Exponential, because the failure being retried is server-side
            # congestion — retrying hard makes it worse for everyone.
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))

    return None


def _attempt_batch(batch: list[str], language: str) -> list[str] | None:
    from google.genai import types

    from app.services.rag import get_client

    prompt = PROMPT.format(
        language=language,
        count=len(batch),
        lines=json.dumps(batch, ensure_ascii=False),
    )

    try:
        response = get_client().models.generate_content(
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
