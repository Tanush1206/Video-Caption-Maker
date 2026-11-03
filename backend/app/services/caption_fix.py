"""
"Improve captions with Gemini" (v1.3.0): Gemini proposes fixes for misheard
words in the caption text; checks here decide which are kept.

Text only. The captions' timings are never sent and never change; only the
words of captions Gemini is sure of are replaced, and every replacement is
recorded so it can be undone one by one or all together.

Measured before it was built (PROGRESS.md, v1.3.0 Part C), unguarded: on a
noisy Hinglish vlog and a clean tutorial it cut word errors by 1.4 and 2.7
points, and it also made confident wrong edits — "2026" to "20 23", "jaa
raha" to "chhod raha", "blinkit" to "manage". The guards below are why those
no longer get through: a fix may only respell words or swap one for another
that sounds alike, never touch a number or rewrite a name, and never change
more than a few words of a caption.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)

# Captions per request: enough context for Gemini to read the speech, few
# enough that one answer is quick to check and cheap to retry.
BATCH_SIZE = 60
# Before a run has timed a batch of its own: measured 2026-11-01 at 100-180 s
# per 60 captions on a busy day and about 20 s on a quiet one.
SECONDS_PER_BATCH_GUESS = 60.0
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 10

# A fix may change at most this many words of a caption, and never more than
# half of a caption longer than two words.
MAX_CHANGED_WORDS = 3

QUOTA_MESSAGE = (
    "Gemini's free quota is used up for now, so the captions weren't checked. "
    "It refills daily: try again later."
)
FAILED_MESSAGE = "Gemini couldn't be reached, so the captions weren't checked. Try again in a few minutes."

PROMPT = """You are proofreading automatic captions of a video. They were made by speech recognition,
in Roman letters; the speech may be Hindi, English or both mixed (Hinglish). Find words that were
clearly MISHEARD and give the fix.

Fix only when you are sure:
- a word that makes no sense there, where a word that SOUNDS ALIKE obviously fits
  (e.g. "Main itna hari mein kaam" -> "Main itna hurry mein kaam");
- a misspelled word, fixed to the same word ("Dlicious" -> "Delicious", "kaaphi" -> "kaafi").

Never:
- change numbers, dates, names, brand names or English words, except to fix the spelling of
  that same word;
- change a word into one with a different or opposite meaning ("jaa raha" must never become
  "chhod raha");
- add or remove words, translate, rephrase, or correct grammar that was really spoken that way;
- change punctuation alone, or a caption you are not sure about.

Captions, as a JSON array; "i" is each caption's index:
{captions}

Answer with a JSON array of ONLY the captions you fix (an empty array if none), each as
{{"i": <index>, "original": "<the caption exactly as given>", "fixed": "<the whole caption, fixed>"}}"""


class QuotaExhausted(Exception):
    """Gemini answered 429: the key is fine, its quota is spent."""


class GeminiUnavailable(Exception):
    """Gemini failed every attempt for a reason other than quota."""


# ── Proposals ──────────────────────────────────────────────────────────────


def propose(texts: list[str], api_key: str, model: str) -> list[dict]:
    """
    Gemini's fixes for one batch: [{"i", "original", "fixed"}], unchecked.

    Retried on transient failures; a 429 is not retried, as it won't clear
    within a run.
    """
    from google.genai import types

    from app.services.rag import get_client

    captions = json.dumps([{"i": i, "text": t} for i, t in enumerate(texts)], ensure_ascii=False)
    last: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = get_client(api_key).models.generate_content(
                model=model,
                contents=PROMPT.format(captions=captions),
                config=types.GenerateContentConfig(
                    # A check, not a creative task.
                    temperature=0.1,
                    response_mime_type="application/json",
                    # Thinking tokens count against this; see translation.py.
                    max_output_tokens=16000,
                    thinking_config=types.ThinkingConfig(thinking_level="low"),
                ),
            )
            payload = json.loads((response.text or "").strip() or "[]")
            if not isinstance(payload, list):
                raise ValueError(f"expected a list, got {type(payload).__name__}")
            return [p for p in payload if isinstance(p, dict)]
        except Exception as exc:  # noqa: BLE001
            if "429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
                raise QuotaExhausted() from exc
            logger.warning("Caption check failed (attempt %d): %s", attempt + 1, str(exc)[:200])
            last = exc
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    raise GeminiUnavailable() from last


# ── Guards ─────────────────────────────────────────────────────────────────

_DIGRAPHS = (
    ("chh", "C"), ("ch", "C"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("sh", "s"),
    ("th", "t"), ("dh", "d"), ("bh", "b"), ("jh", "j"), ("ck", "k"),
)
_SAME_SOUND = str.maketrans({"c": "k", "q": "k", "z": "j", "w": "b", "v": "b", "x": "k"})


def sound(text: str) -> str:
    """
    How a Roman Hinglish or English word sounds, roughly: its consonants.

    Spelling variants of one word come out the same ("kyonki"/"kyunki",
    "kaaphi"/"kaafi", "vah"/"woh", "Dekor"/"Decor"); vowels are dropped, as
    Roman Hindi writes them every which way, and so is `h` after the start.
    """
    out = []
    for word in re.findall(r"[^\W\d_]+", text.lower()):
        for pair, single in _DIGRAPHS:
            word = word.replace(pair, single)
        word = word.translate(_SAME_SOUND)
        head, rest = word[:1], word[1:]
        rest = re.sub(r"[aeiouyh]", "", rest)
        head = "" if head in "aeiou" else head
        out.append(re.sub(r"(.)\1+", r"\1", head + rest))
    return "".join(out)


def _distance(a: str, b: str) -> int:
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def _protected(words: list[str], start: int, all_words: list[str]) -> bool:
    """A name, brand or initialism: capitalised mid-sentence, or all capitals."""
    for offset, word in enumerate(words):
        letters = re.sub(r"[^\w]", "", word)
        if len(letters) > 1 and letters.isupper():
            return True
        position = start + offset
        after_stop = position == 0 or all_words[position - 1][-1:] in ".?!"
        if letters[:1].isupper() and not after_stop:
            return True
    return False


def check(original: str, fixed: str) -> str | None:
    """
    Why a proposed fix is refused, or None to keep it.

    - "unchanged" / "empty";
    - "too many words": more than MAX_CHANGED_WORDS, or over half the caption;
    - "adds or removes words": a word with nothing in its place;
    - "number": a changed word with a digit in it, before or after;
    - "name": a name, brand or initialism changed beyond its spelling;
    - "different word": a word swapped for one that doesn't sound alike.

    Alike: the same consonants (a respelling), or, for three consonants or
    more, one consonant different ("hari"/"hurry", "corona"/"corner").
    """
    fixed = " ".join(fixed.split())
    original = " ".join(original.split())
    if not fixed:
        return "empty"
    if fixed == original:
        return "unchanged"
    a, b = original.split(), fixed.split()
    blocks = [op for op in SequenceMatcher(None, a, b, autojunk=False).get_opcodes() if op[0] != "equal"]
    changed = sum(max(i2 - i1, j2 - j1) for _, i1, i2, j1, j2 in blocks)
    if changed > MAX_CHANGED_WORDS or (len(a) > 2 and changed * 2 > len(a)):
        return "too many words"
    for op, i1, i2, j1, j2 in blocks:
        before, after = " ".join(a[i1:i2]), " ".join(b[j1:j2])
        if op != "replace":
            return "adds or removes words"
        if any(ch.isdigit() for ch in before + after):
            return "number"
        was, now = sound(before), sound(after)
        if was == now:
            continue
        if _protected(a[i1:i2], i1, a):
            return "name"
        if min(len(was), len(now)) < 3 or _distance(was, now) > 1:
            return "different word"
    return None


@dataclass
class Fix:
    index: int
    before: str
    after: str


def accept(texts: list[str], proposals: list[dict]) -> tuple[list[Fix], int]:
    """The proposals that pass every check, and how many were dropped."""
    kept: list[Fix] = []
    dropped = 0
    seen: set[int] = set()
    for p in proposals:
        if not isinstance(p, dict):
            dropped += 1
            continue
        i, original, fixed = p.get("i"), p.get("original"), p.get("fixed")
        if not isinstance(i, int) or not 0 <= i < len(texts) or i in seen or not isinstance(fixed, str):
            dropped += 1
            continue
        # Gemini quotes the caption it fixed; another caption's words mean
        # the answer is misaligned, and the fix would land in the wrong place.
        if not isinstance(original, str) or " ".join(original.split()) != " ".join(texts[i].split()):
            dropped += 1
            continue
        reason = check(texts[i], fixed)
        if reason is None:
            seen.add(i)
            kept.append(Fix(index=i, before=texts[i], after=" ".join(fixed.split())))
        elif reason != "unchanged":
            dropped += 1
            logger.info("Dropped a caption fix (%s): %r -> %r", reason, texts[i], fixed)
    return kept, dropped


def word_parts(before: str, after: str) -> tuple[list[dict], list[dict]]:
    """Both texts as runs of words, each marked changed or not: for highlighting."""
    a, b = before.split(), after.split()
    left: list[dict] = []
    right: list[dict] = []
    for op, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if i2 > i1:
            left.append({"text": " ".join(a[i1:i2]), "changed": op != "equal"})
        if j2 > j1:
            right.append({"text": " ".join(b[j1:j2]), "changed": op != "equal"})
    return left, right


def batches(count: int) -> int:
    return max(1, -(-count // BATCH_SIZE))


def seconds_left(total: int, done: int, seconds_per_batch: float | None) -> int:
    """The time estimate: this run's own pace once it has one."""
    pace = seconds_per_batch or SECONDS_PER_BATCH_GUESS
    return max(0, round((total - done) * pace))


# ── Runs ───────────────────────────────────────────────────────────────────
# Database side, for the API and the worker. Imported late: the guards above
# are plain functions, tested and measured without a database.


class AlreadyRunning(Exception):
    pass


async def latest_run(db, video_id: int):
    from sqlalchemy import select

    from app.models.caption_fix import CaptionFixRun

    return (await db.execute(
        select(CaptionFixRun).where(CaptionFixRun.video_id == video_id)
        .order_by(CaptionFixRun.id.desc()).limit(1)
    )).scalar_one_or_none()


async def start_run(db, video_id: int, caption_count: int):
    """A queued run for the video; AlreadyRunning if one is queued or running."""
    from app.models.caption_fix import ACTIVE_FIX_STATUSES, CaptionFixRun

    current = await latest_run(db, video_id)
    if current is not None and current.status in ACTIVE_FIX_STATUSES:
        raise AlreadyRunning()
    run = CaptionFixRun(video_id=video_id, batches_total=batches(caption_count), batches_done=0, dropped=0)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def fixes_of(db, run_id: int) -> list[tuple]:
    """(fix, caption) pairs of a run, in caption order."""
    from sqlalchemy import select

    from app.models.caption import Caption
    from app.models.caption_fix import CaptionFix

    return list((await db.execute(
        select(CaptionFix, Caption).join(Caption, Caption.id == CaptionFix.caption_id)
        .where(CaptionFix.run_id == run_id).order_by(Caption.start_ms, Caption.id)
    )).all())


def undo_one(fix, caption) -> bool:
    """Put the caption back as it was; False if it was edited by hand since."""
    if fix.undone:
        return True
    if caption.text != fix.after:
        return False
    caption.text = fix.before
    fix.undone = True
    return True


async def describe(db, run) -> dict:
    """A run as the API returns it: progress, estimate, and every fix with its words marked."""
    from app.models.caption_fix import ACTIVE_FIX_STATUSES

    active = run.status in ACTIVE_FIX_STATUSES
    fixes = []
    for fix, caption in await fixes_of(db, run.id):
        before_words, after_words = word_parts(fix.before, fix.after)
        fixes.append({
            "id": fix.id, "caption_id": caption.id, "start_ms": caption.start_ms, "end_ms": caption.end_ms,
            "before": fix.before, "after": fix.after,
            "before_words": before_words, "after_words": after_words,
            "undone": fix.undone, "edited": not fix.undone and caption.text != fix.after,
        })
    return {
        "id": run.id, "status": run.status, "batches_total": run.batches_total, "batches_done": run.batches_done,
        "seconds_left": seconds_left(run.batches_total, run.batches_done, run.seconds_per_batch) if active else None,
        "dropped": run.dropped, "error_message": run.error_message, "fixes": fixes,
    }


async def undo(db, run, fix_id: int | None) -> tuple[list[int], int]:
    """
    Undo one fix of the run (or every fix, for None): (captions put back, edited since).

    A caption edited by hand after the fix keeps the edit and is counted.
    """
    restored, edited = [], 0
    for fix, caption in await fixes_of(db, run.id):
        if fix_id is not None and fix.id != fix_id:
            continue
        if fix.undone:
            continue
        if undo_one(fix, caption):
            restored.append(caption.id)
        else:
            edited += 1
    await db.commit()
    return restored, edited
