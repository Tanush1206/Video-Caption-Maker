"""A short transcription on a fresh install, timed step by step (v1.4.0).

    python scripts/ci_smoke.py --base http://localhost:3000 --english en.mp4 --hindi hi.mp4 --out times.json

Run by the arm64 workflow on both architectures, so the same work gets
times on amd64 and arm64. It exercises every engine:
- English clip, captions as spoken: faster-whisper (the tier's model);
- Hindi clip in Hinglish, captions in Spanish: Apex, then IndicXlit to
  Devanagari, then M2M100 to Spanish;
- the English clip burned into an MP4: FFmpeg.
Each video it creates is deleted at the end. Exits non-zero on any failure.
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path


def call(base, method, path, body=None, raw=None, headers=None, timeout=1800):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"Origin": base, **(headers or {})}
    if body is not None:
        h["Content-Type"] = "application/json"
    request = urllib.request.Request(base + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
        return json.loads(payload) if payload and response.headers.get_content_type() == "application/json" else payload


def upload_held(base, path: Path) -> int:
    boundary = uuid.uuid4().hex
    raw = b"".join([
        f'--{boundary}\r\nContent-Disposition: form-data; name="hold"\r\n\r\ntrue\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        "Content-Type: video/mp4\r\n\r\n".encode() + path.read_bytes() + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    return call(base, "POST", "/api/videos", raw=raw, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})["id"]


def wait(base, path, done, timeout=1800):
    """Poll until the status is in `done`; return the body and the seconds spent in each stage."""
    stages: dict[str, float] = {}
    last, since = None, time.monotonic()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = call(base, "GET", path)
        stage = body.get("stage") or body.get("status")
        if stage != last:
            if last is not None:
                stages[last] = stages.get(last, 0) + time.monotonic() - since
            last, since = stage, time.monotonic()
        if body["status"] in done:
            return body, stages
        time.sleep(1)
    raise RuntimeError(f"{path} timed out")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--english", type=Path, required=True)
    parser.add_argument("--hindi", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--expect", default="caption", help="a word the English clip says")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    base = args.base
    system = call(base, "GET", "/api/system")
    times = {"whisper": system["whisper"]["model"], "steps": {}}
    made: list[int] = []
    failures = []

    def run(label, clip, transcribe):
        started = time.monotonic()
        video_id = upload_held(base, clip)
        made.append(video_id)
        call(base, "POST", f"/api/videos/{video_id}/transcribe", body=transcribe)
        body, stages = wait(base, f"/api/videos/{video_id}", {"completed", "failed"})
        total = time.monotonic() - started
        items = call(base, "GET", f"/api/videos/{video_id}/captions")["items"]
        texts = [c["text"] for c in items]
        downloading = stages.get("downloading", 0)
        times["steps"][label] = {"total_s": round(total, 1), "without_downloads_s": round(total - downloading, 1),
                                 "stages_s": {k: round(v, 1) for k, v in stages.items()}, "captions": len(texts)}
        print(f"{label}: {body['status']} in {total:.0f}s ({total - downloading:.0f}s without downloads), "
              f"{len(texts)} captions: {' | '.join(texts[:3])}", flush=True)
        if body["status"] != "completed" or not texts:
            failures.append(f"{label}: {body['status']} {body.get('error_message')}")
        return video_id, texts

    english_id, english = run("english (faster-whisper)", args.english,
                              {"spoken_language": "en", "caption_language": "same"})
    if english and not re.search(args.expect, " ".join(english), re.I):
        failures.append(f"english: {args.expect!r} not heard in {english}")

    _, spanish = run("hinglish to spanish (Apex, IndicXlit, M2M100)", args.hindi,
                     {"spoken_language": "hi", "caption_language": "es", "hindi_script": "roman"})
    if spanish and not all(re.search(r"[A-Za-z]", t) for t in spanish):
        failures.append(f"spanish: not all Latin: {spanish}")

    started = time.monotonic()
    export = call(base, "POST", f"/api/videos/{english_id}/exports", body={"format": "mp4"})
    if export["status"] != "completed":
        export, _ = wait(base, f"/api/exports/{export['id']}", {"completed", "failed"})
    burn = time.monotonic() - started
    times["steps"]["burn mp4 (FFmpeg)"] = {"total_s": round(burn, 1)}
    print(f"burn: {export['status']} in {burn:.0f}s", flush=True)
    if export["status"] != "completed":
        failures.append(f"burn: {export.get('error_message')}")

    for video_id in made:
        call(base, "DELETE", f"/api/videos/{video_id}")
    print(f"deleted test videos {made}")
    args.out.write_text(json.dumps(times, indent=1), encoding="utf-8")
    for failure in failures:
        print(f"FAIL {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
