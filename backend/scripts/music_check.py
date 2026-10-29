"""
Check a video's captions for what a speech model says over music (v1.2.1).

Fails a video when:
- a caption is mostly one repeated token: one word is more than half of its
  words and comes 3 or more times ("nan nan nan nan…");
- a caption still holds a model's non-speech marker as a word ("nan" from
  the Hinglish model, transcription.NON_SPEECH_WORDS), or is nothing but
  Whisper's filler over music ("कर दो करते हैं", NON_SPEECH_PHRASES);
- a phrase given with --keep is missing: real repetition that must survive
  ("khelta jaoon, khelta jaoon, …"), matched loosely (case, punctuation).
  A caption holding a kept phrase is not counted as repeating: "nahin.
  Nahin. Nahin." at 2:47 of the vlog is someone saying it.

Read-only. Run in the dev worker, next to coverage_check.py:

    docker compose exec -T worker python scripts/music_check.py 7680 --keep "khelta jaoon"
"""

import argparse
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import transcription  # noqa: E402

MARKERS = {word for words in transcription.NON_SPEECH_WORDS.values() for word in words}
PHRASES = tuple(p for phrases in transcription.NON_SPEECH_PHRASES.values() for p in phrases)


def captions(video_id: int) -> list[dict]:
    with urllib.request.urlopen(f"http://backend:8000/api/videos/{video_id}/captions", timeout=60) as r:
        return json.load(r)["items"]


def bare(word: str) -> str:
    return transcription._bare(word)


def mostly_one_token(text: str) -> str | None:
    words = [bare(w) for w in text.split() if bare(w)]
    if not words:
        return None
    word, count = Counter(words).most_common(1)[0]
    return word if count >= 3 and count > len(words) / 2 else None


def loose(text: str) -> str:
    return " ".join(bare(w) for w in text.split())


def check(video_id: int, keep: list[str]) -> int:
    items = captions(video_id)
    failures = 0
    for c in items:
        at = f"{c['start_ms'] / 1000:7.2f}s"
        kept = any(loose(phrase) in loose(c["text"]) for phrase in keep)
        token = None if kept else mostly_one_token(c["text"])
        if token:
            failures += 1
            print(f"  FAIL {at} mostly '{token}': {c['text'][:80]}")
        elif any(bare(w) in MARKERS for w in c["text"].split()):
            failures += 1
            print(f"  FAIL {at} non-speech marker: {c['text'][:80]}")
        elif transcription._only_phrases(c["text"], PHRASES):
            failures += 1
            print(f"  FAIL {at} filler over music: {c['text'][:80]}")
    joined = " ".join(loose(c["text"]) for c in items)
    for phrase in keep:
        found = joined.count(loose(phrase))
        print(f"  {'ok  ' if found else 'FAIL'} kept '{phrase}': {found} time(s)")
        failures += not found
    print(f"video {video_id}: {len(items)} captions, {failures} failure(s)")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_ids", type=int, nargs="+")
    parser.add_argument("--keep", action="append", default=[], help="a phrase that must still be there")
    args = parser.parse_args()
    return 1 if sum(check(v, args.keep) for v in args.video_ids) else 0


if __name__ == "__main__":
    sys.exit(main())
