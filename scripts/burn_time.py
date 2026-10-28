"""
How long an MP4 burn takes on a running install, against the video's length.

    python scripts/burn_time.py --base http://localhost:3000 --video long.mp4 --min-speed 1

Uploads the video, waits for its captions, burns an MP4 at the source's own
size and times it from the export request to the finished file. Prints when
the burn passed each quarter, so a stall shows where it happened, then
deletes the video it uploaded. The encoder it used is in the worker's log
("NVENC available" and the logged FFmpeg command), with its own timing. Exits non-zero if the burn fails or runs
slower than `--min-speed` times real time.

Standard library only, like scripts/e2e.py, whose calls it shares.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from e2e import call, upload, wait  # noqa: E402


def burn(base: str, video_id: int, duration_s: float, timeout: float) -> tuple[bool, float]:
    started = time.time()
    status, export = call(base, "POST", f"/api/videos/{video_id}/exports", {"format": "mp4"})
    if status != 201:
        print(f"  FAIL export: {status} {export}")
        return False, 0.0

    marks = [25, 50, 75]
    last_progress, last_change = -1, started
    while time.time() - started < timeout:
        _, export = call(base, "GET", f"/api/exports/{export['id']}")
        now = time.time()
        if export["progress"] != last_progress:
            last_progress, last_change = export["progress"], now
        while marks and export["progress"] >= marks[0]:
            print(f"    {marks.pop(0)}% after {now - started:.0f}s")
        if export["status"] in ("completed", "failed"):
            break
        if now - last_change > 120:
            print(f"  FAIL no progress for 2 minutes, stuck at {last_progress}%")
            return False, now - started
        time.sleep(1)

    took = time.time() - started
    if export["status"] != "completed":
        print(f"  FAIL burn: {export['status']} {export.get('error_message')}")
        return False, took
    print(
        f"  ok  burned {duration_s / 60:.1f} min of video in {took:.0f}s "
        f"({duration_s / took:.1f}x real time, {export['size_bytes']:,} bytes)"
    )
    return True, took


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--min-speed", type=float, default=1.0, help="slowest acceptable, x real time")
    parser.add_argument("--timeout", type=float, default=3600)
    args = parser.parse_args()

    _, options = call(args.base, "GET", "/api/system")
    print(f"install: whisper={options.get('whisper')}")

    created = upload(args.base, args.video, "same")
    video_id = created["id"]
    print(f"uploaded {args.video.name} as video {video_id}")
    try:
        video = wait(args.base, f"/api/videos/{video_id}", {"completed", "failed"}, args.timeout, "video")
        if video["status"] != "completed":
            print(f"  FAIL transcription: {video.get('error_message')}")
            return 1
        ok, took = burn(args.base, video_id, video["duration_ms"] / 1000, args.timeout)
    finally:
        status, _ = call(args.base, "DELETE", f"/api/videos/{video_id}")
        print(f"deleted video {video_id}: {status}")

    if not ok:
        return 1
    speed = video["duration_ms"] / 1000 / took
    if speed < args.min_speed:
        print(f"  FAIL {speed:.1f}x real time is slower than --min-speed {args.min_speed}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
