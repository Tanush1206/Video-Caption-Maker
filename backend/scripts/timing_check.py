"""
Check captions against the speech they caption (v1.0.8 timing rules).

Checks each video's captions against the word timestamps they were made
from, which the transcription keeps with the video (`videos.speech`):

  - no gap under 0.5 s between consecutive captions, except a 2-frame
    separation (80 ms);
  - no stretch of speech with no caption on screen (beyond those 80 ms);
  - no caption more than 0.5 s past its last spoken word;
  - every caption 0.8-7 s; no overlaps.

Run where the database is (the dev backend or worker):

    docker compose exec -T worker python scripts/timing_check.py 7519 7520 7518

A video transcribed before v1.0.8 has no stored timings and is reported as
such. Exits non-zero on any failure. Reads only.
"""

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.video import Video  # noqa: E402

PAUSE_MS, SEPARATION_MS, TAIL_MS, MIN_MS, MAX_MS = 500, 80, 500, 800, 7000
TOLERANCE_MS = 0


def captions(video_id: int) -> list[dict]:
    with urllib.request.urlopen(f"http://backend:8000/api/videos/{video_id}/captions", timeout=60) as r:
        return json.load(r)["items"]


async def speech(video_id: int) -> list[tuple[int, int]] | None:
    async with AsyncSessionLocal() as session:
        stored = (await session.get(Video, video_id)).speech
    return [(s, e) for s, e in stored] if stored else None


def check(name: str, caps: list[dict], words: list[tuple[int, int]]) -> list[str]:
    problems = []
    for a, b in zip(caps, caps[1:]):
        gap = b["start_ms"] - a["end_ms"]
        if gap < 0:
            problems.append(f"overlap at {a['end_ms'] / 1000:.2f}s")
        elif SEPARATION_MS < gap < PAUSE_MS:
            problems.append(f"{gap} ms flicker gap at {a['end_ms'] / 1000:.2f}s")
    for c in caps:
        length = c["end_ms"] - c["start_ms"]
        if not MIN_MS <= length <= MAX_MS:
            problems.append(f"{length / 1000:.2f}s caption at {c['start_ms'] / 1000:.2f}s")
        spoken = [e for s, e in words if s < c["end_ms"] and e > c["start_ms"]]
        if spoken and c["end_ms"] - max(spoken) > TAIL_MS + TOLERANCE_MS:
            problems.append(f"caption at {c['start_ms'] / 1000:.2f}s runs {c['end_ms'] - max(spoken)} ms past its last word")
    for s, e in words:
        covered = sum(max(0, min(e, c["end_ms"]) - max(s, c["start_ms"])) for c in caps)
        # One 2-frame separation is allowed for every caption change inside the word.
        changes = sum(1 for a, b in zip(caps, caps[1:]) if s < b["start_ms"] and a["end_ms"] < e)
        if e - s - covered > SEPARATION_MS * max(1, changes) + TOLERANCE_MS:
            problems.append(f"speech at {s / 1000:.2f}-{e / 1000:.2f}s uncaptioned")
    print(f"{name}: {len(caps)} captions — " + ("OK" if not problems else f"FAIL ({len(problems)}): " + "; ".join(problems[:6])))
    return problems


async def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ids = [int(i) for i in sys.argv[1:]]
    failed = False
    for video_id in ids:
        words = await speech(video_id)
        if words is None:
            print(f"{video_id}: no stored word timings (transcribed before v1.0.8)")
            failed = True
            continue
        failed |= bool(check(f"{video_id} ({len(words)} words)", captions(video_id), words))
    print("ALL PASSED" if not failed else "FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
