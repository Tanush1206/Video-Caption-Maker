"""
Every Download serves its own file, under a name that says what it is.

    python scripts/download_check.py --base http://localhost:3000 --video long.mp4 --min-burn-gb 1

Uploads the video, waits for its captions, makes an SRT, a VTT and an MP4
burn at the source's own size, then downloads each of them and the original
through `--base` (the production frontend, so through its proxy), exactly as
the export panel's buttons do. Each download must:

- match its own file on disk, byte for byte (size and SHA-256, read inside
  `--container`, the install's API container);
- be named for what it is: the burn says "captions" and its height, the
  original says "original", and no two share a name;
- carry `Cache-Control: no-store`, so a browser never answers one download
  with another's bytes.

The burn must differ from the original, and with `--min-burn-gb` be at least
that large, which is where a proxy that cuts large files would show. Deletes
the video it uploaded. Exits non-zero on any failure.

Standard library only, like scripts/e2e.py, whose calls it shares.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))

from e2e import call, upload, wait  # noqa: E402

HEADERS = ("Content-Disposition", "Content-Length", "Content-Type", "ETag", "Cache-Control")

# Run inside the API container: where each of the video's files is, how big,
# and its SHA-256. The paths never leave the container; only the sums do.
ON_DISK = """
import asyncio, hashlib, json, sys
from sqlalchemy import text
from app.database import engine
from app.services import storage

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()

async def main(video_id):
    async with engine.connect() as c:
        video = (await c.execute(text("select storage_path from videos where id = :v"), {"v": video_id})).scalar_one()
        rows = (await c.execute(text("select id, storage_path from exports where video_id = :v"), {"v": video_id})).all()
    files = {"original": video, **{str(i): p for i, p in rows}}
    out = {}
    for key, rel in files.items():
        path = storage.resolve(rel)
        out[key] = {"size": path.stat().st_size, "sha256": digest(path)}
    print(json.dumps(out))

asyncio.run(main(int(sys.argv[1])))
"""


def on_disk(container: str, video_id: int) -> dict:
    result = subprocess.run(
        ["docker", "exec", "-i", container, "python", "-", str(video_id)],
        input=ON_DISK, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


def filename(disposition: str | None) -> str:
    """The saved name, from either form of Content-Disposition."""
    for part in (disposition or "").split(";"):
        key, _, value = part.strip().partition("=")
        if key == "filename*":
            return unquote(value.split("''", 1)[1])
        if key == "filename":
            return value.strip('"')
    return ""


def fetch(base: str, url: str) -> tuple[int, dict, int, str]:
    """Stream the body to a hash: a burn can be larger than this machine's free memory."""
    with urllib.request.urlopen(base + url, timeout=600) as response:
        headers = {name: response.headers.get(name) for name in HEADERS}
        digest, size = hashlib.sha256(), 0
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            size += len(chunk)
        return response.status, headers, size, digest.hexdigest()


def export(base: str, video_id: int, fmt: str, timeout: float) -> dict:
    body: dict = {"format": fmt}
    if fmt == "mp4":
        # As the panel does: the height it picks is the source's own size.
        _, options = call(base, "GET", f"/api/videos/{video_id}/exports/options")
        body["height"] = options["recommended_height"] or options["source_height"]
    status, made = call(base, "POST", f"/api/videos/{video_id}/exports", body)
    if status != 201:
        raise RuntimeError(f"export {fmt}: {status} {made}")
    if made["status"] != "completed":
        made = wait(base, f"/api/exports/{made['id']}", {"completed", "failed"}, timeout, fmt)
    if made["status"] != "completed":
        raise RuntimeError(f"export {fmt}: {made.get('error_message')}")
    return made


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--container", default="vcm-backend-1", help="the API container, to read the files on disk")
    parser.add_argument("--min-burn-gb", type=float, default=0, help="fail if the burn is smaller than this")
    parser.add_argument("--timeout", type=float, default=3600)
    args = parser.parse_args()

    failures: list[str] = []

    def check(label: str, passed: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if passed else 'FAIL'} {label}{': ' + detail if detail else ''}")
        if not passed:
            failures.append(label)

    created = upload(args.base, args.video, "same")
    video_id = created["id"]
    print(f"uploaded {args.video.name} as video {video_id}")
    try:
        video = wait(args.base, f"/api/videos/{video_id}", {"completed", "failed"}, args.timeout, "video")
        if video["status"] != "completed":
            print(f"  FAIL transcription: {video.get('error_message')}")
            return 1

        # The URLs the export panel builds (hooks/use-exports.ts, use-stream.ts).
        downloads: dict[str, tuple[str, dict]] = {}
        for fmt in ("srt", "vtt", "mp4"):
            started = time.time()
            made = export(args.base, video_id, fmt, args.timeout)
            print(f"  made {fmt} as export {made['id']} in {time.time() - started:.0f}s")
            _, ticket = call(args.base, "POST", f"/api/exports/{made['id']}/download-token")
            downloads[fmt] = (f"/api/exports/{made['id']}/download?token={quote(ticket['token'], safe='')}", made)
        _, ticket = call(args.base, "POST", f"/api/videos/{video_id}/stream-token")
        downloads["original"] = (f"/api/videos/{video_id}/stream?token={quote(ticket['token'], safe='')}&download=1", {})

        disk = on_disk(args.container, video_id)
        got: dict[str, dict] = {}
        for kind, (url, made) in downloads.items():
            started = time.time()
            status, headers, size, sha = fetch(args.base, url)
            expected = disk["original" if kind == "original" else str(made["id"])]
            name = filename(headers["Content-Disposition"])
            got[kind] = {"name": name, "sha256": sha, "size": size}
            print(f"\n{kind}: GET {url.split('?')[0]}  {status}, {size:,} bytes in {time.time() - started:.1f}s")
            for header, value in headers.items():
                print(f"    {header}: {value}")
            check(f"{kind} is its own file on disk", status == 200 and size == expected["size"] and sha == expected["sha256"],
                  f"{size:,} bytes {sha[:12]}, on disk {expected['size']:,} bytes {expected['sha256'][:12]}")
            check(f"{kind} Content-Length matches", headers["Content-Length"] == str(expected["size"]))
            check(f"{kind} is never cached", "no-store" in (headers["Cache-Control"] or ""), str(headers["Cache-Control"]))

        burn = downloads["mp4"][1]
        print()
        check("burn differs from the original", got["mp4"]["sha256"] != got["original"]["sha256"])
        check("burn's name says captions and its height",
              "captions" in got["mp4"]["name"] and f"{burn['height']}p" in got["mp4"]["name"] and got["mp4"]["name"].endswith(".mp4"),
              got["mp4"]["name"])
        check("original's name says original", "original" in got["original"]["name"], got["original"]["name"])
        check("sidecars are named for the video", got["srt"]["name"].endswith(".srt") and got["vtt"]["name"].endswith(".vtt"),
              f"{got['srt']['name']}, {got['vtt']['name']}")
        names = [item["name"] for item in got.values()]
        check("no two downloads share a name", len(set(names)) == len(names), ", ".join(names))
        if args.min_burn_gb:
            check(f"burn is over {args.min_burn_gb:g} GB", got["mp4"]["size"] > args.min_burn_gb * 1e9, f"{got['mp4']['size']:,} bytes")
    finally:
        status, _ = call(args.base, "DELETE", f"/api/videos/{video_id}")
        print(f"\ndeleted video {video_id}: {status}")

    print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
