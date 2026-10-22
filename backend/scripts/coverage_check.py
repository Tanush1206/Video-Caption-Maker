"""
Check that every stretch of speech has a caption on screen (v1.0.10).

Speech is read from the audio itself, not from what the speech model said:
the speech band (300-3400 Hz) in 20 ms windows, voiced when within 18 dB of
the clip's speaking level (the 80th percentile of its louder half), dips
under 150 ms bridged. A voiced stretch with no caption on screen for more
than 0.7 s fails. Read-only; run where the database and the media are (the
dev worker):

    docker compose exec -T worker python scripts/coverage_check.py 7601 7602

Exits non-zero if any video has uncaptioned speech. Music or a loud room
counts as "voiced" too: a failure is a place to listen, then decide.
"""

import asyncio
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.video import Video  # noqa: E402
from app.services import storage, transcription  # noqa: E402

WINDOW_MS = 20
VOICED_DB = 18.0
BRIDGE_MS = 150
MIN_SECONDS = 0.7


def captions(video_id: int) -> list[dict]:
    with urllib.request.urlopen(f"http://backend:8000/api/videos/{video_id}/captions", timeout=60) as r:
        return json.load(r)["items"]


async def source(video_id: int) -> Path:
    async with AsyncSessionLocal() as session:
        return storage.resolve((await session.get(Video, video_id)).storage_path)


def voiced(levels: list[float]) -> list[bool]:
    louder = sorted(levels)[len(levels) // 2:]
    speaking = louder[int(len(louder) * 0.8)]
    flags = [level >= speaking - VOICED_DB for level in levels]
    i = 0
    while i < len(flags):
        if flags[i]:
            i += 1
            continue
        j = i
        while j < len(flags) and not flags[j]:
            j += 1
        if 0 < i and j < len(flags) and (j - i) * WINDOW_MS < BRIDGE_MS:
            flags[i:j] = [True] * (j - i)
        i = j
    return flags


def uncaptioned(flags: list[bool], caps: list[dict]) -> list[tuple[float, float]]:
    covered = [False] * len(flags)
    for c in caps:
        for k in range(c["start_ms"] // WINDOW_MS, min(len(flags), c["end_ms"] // WINDOW_MS + 1)):
            covered[k] = True
    found, k = [], 0
    while k < len(flags):
        if flags[k] and not covered[k]:
            j = k
            while j < len(flags) and flags[j] and not covered[j]:
                j += 1
            if (j - k) * WINDOW_MS / 1000 > MIN_SECONDS:
                found.append((k * WINDOW_MS / 1000, j * WINDOW_MS / 1000))
            k = j
        else:
            k += 1
    return found


async def main(ids: list[int]) -> int:
    failed = 0
    for video_id in ids:
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "audio.wav"
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(await source(video_id)), "-vn", "-ac", "1", "-ar", "16000", str(wav)],
                check=True, timeout=600,
            )
            levels = transcription.vocal_envelope(wav, WINDOW_MS / 1000)
        stretches = uncaptioned(voiced(levels), captions(video_id))
        status = "FAIL" if stretches else "PASS"
        failed += bool(stretches)
        print(f"{status} video {video_id}: {len(stretches)} stretch(es) of speech over {MIN_SECONDS} s with no caption")
        for a, b in stretches:
            print(f"     {a:7.2f}-{b:7.2f} s ({b - a:.2f} s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main([int(a) for a in sys.argv[1:]])))
