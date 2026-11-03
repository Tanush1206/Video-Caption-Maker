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
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.services import hinglish_spelling

logger = logging.getLogger(__name__)

# Captions per request: enough context for Gemini to read the speech, few
# enough that one answer is quick to check and cheap to retry.
BATCH_SIZE = 60
# Before a run has timed a batch of its own: measured 2026-11-01 at 100-180 s
# per 60 captions on a busy day and about 20 s on a quiet one.
SECONDS_PER_BATCH_GUESS = 60.0
# Per request. Longer than the shared client's 60 s (services/rag.py), which
# suits a translation that falls back to the local model: on 2026-11-03 every
# flash request took over a minute, ending in Google's own 504 at 60 s, even
# for 2 captions.
REQUEST_TIMEOUT_MS = 300_000
# Asked once when the configured model fails (busy, timed out, quota, a
# broken answer): on 2026-11-03 gemini-flash-latest (3.8-flash) timed out or
# answered "high demand" all day while flash-lite answered in 3-9 s. With
# the guards it is not worse than today on either measured clip (D23). Each
# run counts the parts it answered, and the results say so.
FALLBACK_MODEL = "gemini-flash-lite-latest"

_client = None
_client_key = None

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


def _client_for(api_key: str):
    """A Gemini client with this module's longer timeout, rebuilt when the key changes."""
    global _client, _client_key
    if _client is None or _client_key != api_key:
        from google import genai
        from google.genai import types

        _client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
        _client_key = api_key
    return _client


def _ask(texts: list[str], api_key: str, model: str) -> list[dict]:
    """One request to `model`; raises on any failure, a malformed answer included."""
    from google.genai import types

    captions = json.dumps([{"i": i, "text": t} for i, t in enumerate(texts)], ensure_ascii=False)
    response = _client_for(api_key).models.generate_content(
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


def _failure(exc: Exception) -> Exception:
    if "429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc):
        return QuotaExhausted()
    return GeminiUnavailable()


def propose(texts: list[str], api_key: str, model: str) -> tuple[list[dict], str]:
    """
    Gemini's fixes for one batch, unchecked, and the model that gave them.

    One request to `model`; if it fails in any way (busy, timed out, its
    quota spent, a broken answer), one to FALLBACK_MODEL. Quota is granted
    per model, so a 429 is worth the second try too. Both failing raises
    QuotaExhausted if the last was a 429, GeminiUnavailable otherwise.
    """
    try:
        return _ask(texts, api_key, model), model
    except Exception as exc:  # noqa: BLE001
        if model == FALLBACK_MODEL:
            raise _failure(exc) from exc
        logger.warning("Caption check: %s failed (%s); asking %s", model, str(exc)[:200], FALLBACK_MODEL)
    try:
        return _ask(texts, api_key, FALLBACK_MODEL), FALLBACK_MODEL
    except Exception as exc:  # noqa: BLE001
        logger.warning("Caption check: %s failed too (%s)", FALLBACK_MODEL, str(exc)[:200])
        raise _failure(exc) from exc


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


# A protected word may only be respelled: this much of it, letter for
# letter, stays ("ketan"/"Ketan", not "Ketan"/"Chetan" at 0.73).
RESPELLING = 0.8


def _bare(word: str) -> str:
    return re.sub(r"[^\w]", "", word).lower()


def _name_like(word: str, position: int, words: list[str]) -> bool:
    """Capitalised mid-sentence, or all capitals: a name, brand or initialism."""
    letters = re.sub(r"[^\w]", "", word)
    if len(letters) > 1 and letters.isupper():
        return True
    after_stop = position == 0 or words[position - 1][-1:] in ".?!"
    return letters[:1].isupper() and not after_stop


def _ends_open(text: str) -> bool:
    letters = re.sub(r"[^\w]", "", text.split()[-1]).lower() if text.split() else ""
    return letters[-1:] in ("a", "e", "i", "o", "u", "y")


def names_in(texts: list[str]) -> frozenset[str]:
    """
    Every word written as a name anywhere in the captions, lower-cased.

    Speech recognition writes the same name both ways ("Ketan doesn't like",
    "Itni attention ketan ko"), and lower-cased it slipped past the check:
    Gemini turned that "ketan" into "kitni", same consonants. Protected
    everywhere once it is a name anywhere.
    """
    names = set()
    for text in texts:
        words = text.split()
        names.update(_bare(w) for i, w in enumerate(words) if _name_like(w, i, words) and _bare(w))
    return frozenset(names)


def check(original: str, fixed: str, names: frozenset[str] = frozenset()) -> str | None:
    """
    Why a proposed fix is refused, or None to keep it.

    - "unchanged" / "empty";
    - "too many words": more than MAX_CHANGED_WORDS, or over half the caption;
    - "adds or removes words": a word with nothing in its place;
    - "number": a changed word with a digit in it, before or after;
    - "name": a name, brand or initialism (`names`, or written as one here)
      changed beyond its spelling;
    - "different word": a word swapped for one that doesn't sound alike,
      or a "respelling" that changes how the word ends.

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
        if any(_name_like(w, i1 + k, a) or _bare(w) in names for k, w in enumerate(a[i1:i2])):
            if SequenceMatcher(None, before.lower(), after.lower(), autojunk=False).ratio() >= RESPELLING:
                continue
            return "name"
        was, now = sound(before), sound(after)
        # More words or fewer in their place: only ever a spacing fix
        # ("clip champ" -> "clipchamp"), never a word added ("dabaane" ->
        # "dabaana hai", flash-lite).
        if i2 - i1 != j2 - j1 and was != now:
            return "adds or removes words"
        # A respelling keeps how the word ends, on a vowel or not: kaaphi/
        # kaafi, yah/yeh, mainne/maine. "ketan" -> "kitni" has the same
        # consonants and is another word (flash-lite, 2026-11-03).
        if was == now:
            if _ends_open(before) == _ends_open(after):
                continue
            return "different word"
        if min(len(was), len(now)) < 3 or _distance(was, now) > 1:
            return "different word"
    return None


@dataclass
class Fix:
    index: int
    before: str
    after: str


def accept(
    texts: list[str], proposals: list[dict], names: frozenset[str] | None = None, spelling: str | None = None
) -> tuple[list[Fix], int]:
    """
    The proposals that pass every check, and how many were dropped. `names`:
    the whole video's. `spelling`: how its Hinglish is spelled (v1.3.1).
    """
    names = names_in(texts) if names is None else names
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
        if spelling == hinglish_spelling.EVERYDAY:
            # Fixes come out in the captions' own spelling, and one that only
            # respells back to the model's ("nahi" -> "nahin") is no fix.
            fixed = hinglish_spelling.everyday(fixed)
        reason = check(texts[i], fixed, names)
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
        "dropped": run.dropped, "fallback_batches": run.fallback_batches,
        "error_message": run.error_message, "fixes": fixes,
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
