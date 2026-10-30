"""
What each burn quality costs: file size, picture, sound and time.

    python scripts/quality_check.py --base http://localhost:3000 --video long.mp4 \\
        --container vcm-worker-1 --max-same-ratio 1.25

Uploads the video (or uses `--video-id`), waits for its captions, then burns
an MP4 at the source's own size for each `--qualities` level and reports, for
each burn:

- its size against the source's (`--max-same-ratio` fails "same" above it);
- SSIM against the source over the part of the frame no default caption
  reaches (the top `--compare-top` of it), against a floor per level
  (`--min-ssim smaller=0.96,same=0.975,higher=0.985`);
- whether an AAC source's sound was carried over packet for packet;
- the time from the request to the finished file.

SSIM and the sound are read inside `--container` (an app container: it has
FFmpeg and the files). Deletes the video it uploaded, unless `--keep`; a video
given by `--video-id` is never deleted. `--json` appends one line per burn.

Standard library only, like scripts/e2e.py, whose calls it shares.
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from e2e import call, upload, wait  # noqa: E402

# Run inside the container: the two files' paths, sizes, SSIM and sound.
MEASURE = """
import asyncio, json, re, subprocess, sys
from sqlalchemy import text
from app.database import engine
from app.services import storage

video_id, export_id, top = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])

async def paths():
    async with engine.connect() as c:
        source = (await c.execute(text("select storage_path from videos where id = :v"), {"v": video_id})).scalar_one()
        burn = (await c.execute(text("select storage_path from exports where id = :e"), {"e": export_id})).scalar_one()
    return storage.resolve(source), storage.resolve(burn)

def probe(path, stream, entries):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", stream, "-show_entries", entries,
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    streams = json.loads(out).get("streams") or [{}]
    return streams[0]

def packets(path):
    return subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a", "-c", "copy", "-f", "md5", "-"],
                          capture_output=True, text=True).stdout.strip()

source, burn = asyncio.run(paths())
size = probe(burn, "v", "stream=width,height")
crop = f"crop=iw:trunc(ih*{top}/2)*2:0:0"
graph = (f"[0:v]{crop}[a];[1:v]scale={size['width']}:{size['height']}:flags=lanczos,{crop}[b];[a][b]ssim")
log = subprocess.run(["ffmpeg", "-v", "info", "-i", str(burn), "-i", str(source), "-lavfi", graph, "-f", "null", "-"],
                     capture_output=True, text=True).stderr
ssim = re.findall(r"All:([0-9.]+)", log)
print(json.dumps({
    "source_bytes": source.stat().st_size,
    "burn_bytes": burn.stat().st_size,
    "source_video_bps": int(probe(source, "v", "stream=bit_rate").get("bit_rate") or 0),
    "burn_video_bps": int(probe(burn, "v", "stream=bit_rate").get("bit_rate") or 0),
    "ssim": float(ssim[-1]) if ssim else None,
    "source_audio": probe(source, "a", "stream=codec_name").get("codec_name"),
    "burn_audio": probe(burn, "a", "stream=codec_name").get("codec_name"),
    "audio_copied": packets(source) == packets(burn),
}))
"""


def measure(container: str, video_id: int, export_id: int, top: float) -> dict:
    result = subprocess.run(
        ["docker", "exec", "-i", container, "python", "-", str(video_id), str(export_id), str(top)],
        input=MEASURE, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


def burn(base: str, video_id: int, quality: str, timeout: float) -> tuple[dict, float]:
    _, options = call(base, "GET", f"/api/videos/{video_id}/exports/options")
    height = options["recommended_height"] or options["source_height"]
    started = time.time()
    status, export = call(base, "POST", f"/api/videos/{video_id}/exports",
                          {"format": "mp4", "height": height, "quality": quality})
    if status != 201:
        raise RuntimeError(f"export: {status} {export}")
    export = wait(base, f"/api/exports/{export['id']}", {"completed", "failed"}, timeout, quality)
    if export["status"] != "completed":
        raise RuntimeError(f"burn {quality}: {export.get('error_message')}")
    estimate = next((r.get("estimated_bytes", {}).get(quality) for r in options["resolutions"] if r["height"] == height), None)
    export["estimate"] = estimate
    export["encoder"] = options.get("hardware_encoder") or "libx264"
    return export, time.time() - started


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--video-id", type=int, help="burn an existing video instead of uploading one")
    parser.add_argument("--container", default="vcm-worker-1")
    parser.add_argument("--qualities", default="smaller,same,higher")
    parser.add_argument("--max-same-ratio", type=float, default=1.25)
    parser.add_argument("--min-ssim", default="smaller=0.96,same=0.975,higher=0.985")
    parser.add_argument("--compare-top", type=float, default=0.7, help="share of the frame, from the top, to compare")
    parser.add_argument("--label", default="", help="a name for this run in the output")
    parser.add_argument("--json", type=Path, help="append one JSON line per burn")
    parser.add_argument("--keep", action="store_true", help="don't delete an uploaded video")
    parser.add_argument("--timeout", type=float, default=7200)
    args = parser.parse_args()
    floors = {k: float(v) for k, v in (pair.split("=") for pair in args.min_ssim.split(","))}

    if args.video_id:
        video_id, uploaded = args.video_id, False
    else:
        video_id, uploaded = upload(args.base, args.video, "same")["id"], True
        print(f"uploaded {args.video.name} as video {video_id}")
    failures: list[str] = []
    try:
        video = wait(args.base, f"/api/videos/{video_id}", {"completed", "failed"}, args.timeout, "video")
        if video["status"] != "completed":
            print(f"  FAIL transcription: {video.get('error_message')}")
            return 1
        minutes = video["duration_ms"] / 60000
        for quality in args.qualities.split(","):
            export, took = burn(args.base, video_id, quality, args.timeout)
            m = measure(args.container, video_id, export["id"], args.compare_top)
            ratio = m["burn_bytes"] / m["source_bytes"]
            row = {"label": args.label, "quality": quality, "export": export["id"], "encoder": export["encoder"],
                   "seconds": round(took, 1), "minutes_of_video": round(minutes, 2), "ratio": round(ratio, 3),
                   "estimate": export["estimate"], **m}
            print(f"\n{args.label} {quality} (export {export['id']}, {export['encoder']}): "
                  f"{m['burn_bytes']:,} bytes = {ratio:.2f}x the source; video {m['burn_video_bps'] / 1e6:.2f} Mbit/s "
                  f"against {m['source_video_bps'] / 1e6:.2f}; SSIM {m['ssim']}; sound {m['source_audio']} -> "
                  f"{m['burn_audio']}{' (copied)' if m['audio_copied'] else ''}; {took:.0f} s "
                  f"({minutes * 60 / took:.1f}x real time)"
                  + (f"; estimate {export['estimate']:,}" if export["estimate"] else ""))
            if quality == "same" and ratio > args.max_same_ratio:
                failures.append(f"same is {ratio:.2f}x the source, over {args.max_same_ratio}")
            if quality in floors and (m["ssim"] or 0) < floors[quality]:
                failures.append(f"{quality} SSIM {m['ssim']} under {floors[quality]}")
            if m["source_audio"] == "aac" and not m["audio_copied"]:
                failures.append(f"{quality}: AAC sound was not copied")
            if args.json:
                with args.json.open("a", encoding="utf-8") as out:
                    out.write(json.dumps(row) + "\n")
    finally:
        if uploaded and not args.keep:
            status, _ = call(args.base, "DELETE", f"/api/videos/{video_id}")
            print(f"\ndeleted video {video_id}: {status}")

    for failure in failures:
        print(f"  FAIL {failure}")
    print("ALL PASSED" if not failures else f"{len(failures)} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
