"""
Custom vocabulary (v1.3.1): the install's own words, spelled its way.

A word list in Settings (names, brands, words like "vlog"). It is applied to
the caption text when captions are made, not given to the speech model:
passed to Whisper as hotwords or an initial prompt it fixed none of the
target words on the Hinglish model, flipped a meaning ("balcony nahin hai"
-> "balcony hai"), dropped speech and wrote "Thanks for watching" into
English captions; on clips it had nothing to do with it put "S 1000 RR"
into the speech (PROGRESS.md, v1.3.1).

A caption word takes a vocabulary word's spelling when it sounds the same
(services/caption_fix.sound: its consonants, spelling variants folded), so
"acropovic" becomes "Akrapovic" and "laddaakh" "Ladakh". One sound off
("block" -> "vlog") only next to a clearly Hindi word, the rule the English
twins follow in hinglish_spelling, so an English "block" stays. A word too
short to compare by sound ("Leo") only gets its capitals. Only Latin
letters are compared: Devanagari is never changed.
"""

import copy
import re
import unicodedata

from app.services.caption_fix import sound
from app.services.hinglish_spelling import HINDI

MAX_WORDS = 100
MAX_LENGTH = 40
# Between letters and digits (of any script, vowel signs included), what
# names and brands use: "AT&T", "Dr. Who", "O'Brien", "Hyderabad-based".
JOINERS = " '&.-"
# Below this a sound skeleton matches too much ("l" for "Leo").
MIN_SOUND = 3

_WORD = re.compile(r"[A-Za-z0-9]+")


def clean(words: list[str]) -> list[str]:
    """The list as stored: trimmed, blanks and repeats (any case) dropped, in order."""
    out: list[str] = []
    seen: set[str] = set()
    for word in words:
        word = " ".join(word.split())
        if word and word.lower() not in seen:
            seen.add(word.lower())
            out.append(word)
    return out


def _word_like(word: str) -> bool:
    def letter(ch: str) -> bool:
        return unicodedata.category(ch)[0] in "LMN"

    return letter(word[0]) and all(letter(ch) or ch in JOINERS for ch in word)


def invalid(words: list[str]) -> str | None:
    """Why the list can't be saved, or None."""
    if len(words) > MAX_WORDS:
        return f"Up to {MAX_WORDS} words"
    for word in words:
        if len(word) > MAX_LENGTH:
            return f'"{word[:20]}…" is longer than {MAX_LENGTH} characters'
        if not _word_like(word):
            return f'"{word}" has characters a word can\'t have'
    return None


def _entries(vocabulary: list[str]) -> list[tuple[list[str], list[str]]]:
    """Each entry as its tokens and their sounds (digits as themselves)."""
    out = []
    for entry in vocabulary:
        tokens = _WORD.findall(entry)
        if tokens:
            out.append((tokens, [t if t.isdigit() else sound(t) for t in tokens]))
    return out


# Sounds said the same way but one voiced, one not, in sound()'s letters
# (it writes c/q as k, z as j, w/v as b).
VOICING = {frozenset(pair) for pair in ("kg", "pb", "td", "sj", "fb")}


def _twin_swap(have: str, want: str) -> bool:
    """`have` is `want` with one sound swapped for its voiced or voiceless twin."""
    if len(have) != len(want):
        return False
    differ = [(a, b) for a, b in zip(have, want) if a != b]
    return len(differ) == 1 and frozenset(differ[0]) in VOICING


def _target(entry: list[str], sounds: list[str], found: list[str], near_hindi: bool) -> bool:
    """Whether the caption tokens `found` are `entry` spelled another way."""
    if [f.lower() for f in found] == [e.lower() for e in entry] and found != entry:
        return True  # only the capitals differ
    if [f.lower() for f in found] == [e.lower() for e in entry]:
        return False
    total = sum(len(s) for s in sounds if not s.isdigit())
    if total < MIN_SOUND and not any(s.isdigit() for s in sounds):
        return False
    off = 0
    for token, want in zip(found, sounds):
        if want.isdigit():
            if token != want:
                return False
            continue
        have = sound(token)
        if not have:
            return False
        if have != want:
            # One sound swapped for its voiced or voiceless twin ("blk"/"blg":
            # block/vlog), never another sound or one dropped: on leo.mp4 any
            # swap also made banaunga, kadak and lambe into vlog, Ladakh, BMW.
            if len(want) < MIN_SOUND or not _twin_swap(have, want):
                return False
            off += 1
    return off == 0 or (off == 1 and len(entry) == 1 and near_hindi)


def _apply_pieces(pieces: list[str], vocabulary: list[str]) -> list[str]:
    """Each piece with vocabulary words respelled, the pieces read as one run of text."""
    entries = _entries(vocabulary)
    if not entries:
        return list(pieces)
    found = [(p, m) for p, piece in enumerate(pieces) for m in _WORD.finditer(piece)]
    words = [m.group(0) for _, m in found]
    lows = [w.lower() for w in words]
    replace: dict[int, tuple[int, str]] = {}  # first token index -> (token count, text)
    i = 0
    while i < len(words):
        for tokens, sounds in entries:
            n = len(tokens)
            # A multi-word entry only within one piece (one caption, or one timed word).
            if i + n > len(words) or len({found[k][0] for k in range(i, i + n)}) > 1:
                continue
            near = any(lows[j] in HINDI for j in (i - 1, i + n) if 0 <= j < len(words))
            if _target(tokens, sounds, words[i:i + n], near):
                replace[i] = (n, " ".join(tokens))
                break
        i += replace[i][0] if i in replace else 1

    out = list(pieces)
    for i in sorted(replace, reverse=True):
        n, text = replace[i]
        p, first = found[i]
        last = found[i + n - 1][1]
        piece = out[p]
        out[p] = piece[:first.start()] + text + piece[last.end():]
    return out


def apply(text: str, vocabulary: list[str]) -> str:
    """`text` with words that sound like a vocabulary word spelled as it is."""
    return _apply_pieces([text], vocabulary)[0]


def apply_segment(segment, vocabulary: list[str]):
    """A transcription Segment with the vocabulary applied: its text and its timed words alike."""
    out = copy.copy(segment)
    out.text = apply(segment.text, vocabulary)
    speech = getattr(segment, "speech", None) or []
    if speech:
        words = _apply_pieces([w for _, _, w in speech], vocabulary)
        out.speech = [(s, e, w) for (s, e, _), w in zip(speech, words)]
    return out
