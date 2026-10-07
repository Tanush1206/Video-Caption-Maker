"""
Answering questions from a video's own transcript.

Retrieval-augmented generation: find the passages that might answer the
question, hand *only those* to Gemini, and require the answer to come from
them. Optional on a local install: retrieval runs entirely on this machine,
and only writing the answer needs a Gemini key from Settings. The model supplies fluency; the transcript supplies facts.

The milestone's acceptance criterion is not "gives good answers" — it is that
a question the video does not answer comes back as "not found" rather than an
invention. So refusal is designed in twice, at two independent layers:

  1. **Retrieval.** If nothing clears the distance threshold there is no
     context, and we return the refusal without calling the model at all. A
     model given no facts cannot be relied on to admit it.
  2. **Instruction.** When context exists but doesn't actually answer the
     question, the prompt requires the model to say so, and gives it an exact
     sentence to say.

Neither alone is enough. The first cannot judge whether retrieved text answers
the question; the second cannot be trusted on its own.
"""

import logging
from dataclasses import dataclass

from app.config import get_settings
from app.services.search import SearchHit

logger = logging.getLogger(__name__)
settings = get_settings()

NOT_FOUND = "I couldn't find an answer to that in this video."

# Enough context to answer from, few enough that the model isn't picking a
# needle out of a haystack — precision falls off as irrelevant passages pile up.
CONTEXT_CHUNKS = 6

GEMINI_TIMEOUT_MS = 60_000

_client = None
_client_key: str | None = None


@dataclass
class Answer:
    text: str
    # Indices into the hits that were passed in, in citation order. Empty for a
    # refusal.
    cited: list[int]
    grounded: bool


def get_client(api_key: str | None = None):
    """
    A Gemini client for this key, rebuilt when the key changes.

    The key can now be changed at runtime from Settings, so a client cached
    for the life of the process would go on using the old one.
    """
    global _client, _client_key
    key = api_key or settings.gemini_api_key
    if _client is None or _client_key != key:
        from google import genai
        from google.genai import types

        # A timeout, because the SDK has none by default: a stalled request on
        # an overloaded model once held a transcription for six and a half
        # minutes before anything noticed. Sixty seconds is far beyond a
        # healthy batch, and a timeout falls back to the local model.
        _client = genai.Client(
            api_key=key, http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS)
        )
        _client_key = key
    return _client


PROMPT = """\
You answer questions about a video using only the numbered transcript excerpts \
below. The excerpts are the complete set of information you have.

Rules:
- Use only what the excerpts say. Do not add outside knowledge, and do not \
infer beyond what is stated.
- If the excerpts do not answer the question, reply with exactly: {not_found}
- Cite the excerpts you used by their number in square brackets, like [2]. \
Cite every excerpt you relied on.
- Never write a timestamp. Cite the excerpt number and nothing else.
- Be concise: two or three sentences.

Excerpts:
{context}

Question: {question}

Answer:"""


def build_context(hits: list[SearchHit]) -> str:
    return "\n".join(
        f"[{index}] {hit.text.strip()}" for index, hit in enumerate(hits, start=1)
    )


def parse_citations(text: str, hit_count: int) -> list[int]:
    """
    Pull `[n]` markers out of the answer and turn them into 0-based indices.

    Anything out of range is dropped rather than clamped. A citation to an
    excerpt that wasn't provided is a hallucinated one, and silently pointing
    it at a real caption instead would be worse than losing it.
    """
    import re

    seen: list[int] = []
    for match in re.findall(r"\[(\d+)\]", text):
        index = int(match) - 1
        if 0 <= index < hit_count and index not in seen:
            seen.append(index)
    return seen


def answer_question(question: str, hits: list[SearchHit], api_key: str | None = None) -> Answer:
    """
    Synthesize an answer from retrieved captions. Never raises.

    Blocking — the caller runs it off the event loop.
    """
    # Layer one: nothing relevant was retrieved, so there is nothing to answer
    # from. Calling the model here would be paying for a guess.
    if not hits:
        return Answer(text=NOT_FOUND, cited=[], grounded=False)

    api_key = api_key or settings.gemini_api_key
    if not api_key:
        # The local default: search works fully offline, and writing an answer
        # is an optional extra that needs a key.
        return Answer(
            text="Add a Gemini API key in Settings to get written answers. The matching moments are below.",
            cited=[],
            grounded=False,
        )

    context = build_context(hits)
    prompt = PROMPT.format(not_found=NOT_FOUND, context=context, question=question)

    try:
        from google.genai import types

        response = get_client(api_key).models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                # Near-zero temperature: this is an extraction task, and
                # sampling variety here means inventing detail.
                temperature=0.1,
                # Both of these are load-bearing, not tuning preferences.
                #
                # `gemini-flash-latest` resolves to a thinking model, and
                # reasoning tokens are charged against max_output_tokens. At
                # the old cap of 400 a Hindi question spent 382 of them
                # thinking and returned 14 tokens of answer, cut off
                # mid-sentence with finishReason MAX_TOKENS. The cap has to
                # clear the thinking, not just the reply.
                #
                # thinking_budget=0 would be the obvious fix and Gemini 3
                # rejects it outright with 400 INVALID_ARGUMENT — thinking
                # cannot be switched off, only turned down. "low" measured
                # ~300 reasoning tokens against ~565 left at the default.
                max_output_tokens=1500,
                thinking_config=types.ThinkingConfig(thinking_level="low"),
            ),
        )
        text = (response.text or "").strip()
    except Exception as exc:  # noqa: BLE001
        # The captions are still useful on their own, so a failed answer
        # degrades to plain search rather than failing the request.
        logger.error("Gemini call failed: %s", exc)
        return Answer(
            text="The answer service is unavailable right now — results are below.",
            cited=[],
            grounded=False,
        )

    if not text:
        return Answer(text=NOT_FOUND, cited=[], grounded=False)

    # Layer two: the model was given context but decided it didn't answer.
    if NOT_FOUND.rstrip(".").lower() in text.rstrip(".").lower():
        return Answer(text=NOT_FOUND, cited=[], grounded=False)

    return Answer(text=text, cited=parse_citations(text, len(hits)), grounded=True)
