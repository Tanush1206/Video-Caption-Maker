"""
End-to-end check against a running install: upload → transcribe → translate → export.

Uses only the standard library, so it runs on any machine with Python 3.9+,
without installing anything. Requires a local-mode install (no login).

    python scripts/e2e.py --base http://localhost:3000 --video clip.mp4 --languages same,en,hi,fr,de,nl

Exits non-zero if any language fails. For each language it prints the stages
it saw, the time taken, any notice, and the first captions.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def call(base: str, method: str, path: str, body=None, headers=None, raw: bytes | None = None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(base + path, data=data, method=method)
    if body is not None:
        request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            payload = response.read()
            if response.headers.get("Content-Type", "").startswith("application/json"):
                return response.status, json.loads(payload or b"null")
            return response.status, payload
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors="replace")


def upload(base: str, video: Path, language: str) -> dict:
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="caption_language"\r\n\r\n{language}\r\n'.encode(),
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{video.name}"\r\n'
            "Content-Type: video/mp4\r\n\r\n"
        ).encode()
        + video.read_bytes()
        + b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    status, body = call(
        base,
        "POST",
        "/api/videos",
        raw=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    if status != 201:
        raise RuntimeError(f"upload failed: {status} {body}")
    return body


def wait(base: str, path: str, done: set[str], timeout: float, label: str) -> dict:
    deadline = time.time() + timeout
    seen = []
    while time.time() < deadline:
        status, body = call(base, "GET", path)
        if status != 200:
            raise RuntimeError(f"{label}: {status} {body}")
        marker = (body.get("stage"), body.get("stage_detail"))
        if body.get("stage") and (not seen or seen[-1][0] != marker[0]):
            seen.append(marker)
            print(f"    {label}: {marker[0]}  {marker[1] or ''}".rstrip())
        if body["status"] in done:
            return body
        time.sleep(2)
    raise RuntimeError(f"{label}: timed out after {timeout:.0f}s")


def run(base: str, video: Path, language: str, burn: bool, timeout: float) -> bool:
    print(f"\n=== {video.name} → {language}")
    started = time.time()
    created = upload(base, video, language)
    result = wait(base, f"/api/videos/{created['id']}", {"completed", "failed"}, timeout, "video")
    took = time.time() - started
    if result["status"] != "completed":
        print(f"  FAIL transcription: {result.get('error_message')}")
        return False

    _, captions = call(base, "GET", f"/api/videos/{created['id']}/captions")
    items = captions["items"] if isinstance(captions, dict) else captions
    print(f"  ok  {len(items)} captions in {took:.0f}s  notice={result.get('notice')!r}")
    for caption in items[:3]:
        print(f"      {caption['start_ms']/1000:6.1f}s  {caption['text']}")
    if not items:
        print("  FAIL no captions")
        return False

    formats = ["srt", "vtt"] + (["mp4"] if burn else [])
    for fmt in formats:
        status, export = call(base, "POST", f"/api/videos/{created['id']}/exports", {"format": fmt})
        if status != 201:
            print(f"  FAIL export {fmt}: {status} {export}")
            return False
        if export["status"] != "completed":
            export = wait(base, f"/api/exports/{export['id']}", {"completed", "failed"}, timeout, fmt)
        if export["status"] != "completed":
            print(f"  FAIL export {fmt}: {export.get('error_message')}")
            return False
        _, ticket = call(base, "POST", f"/api/exports/{export['id']}/download-token")
        status, payload = call(base, "GET", f"/api/exports/{export['id']}/download?token={ticket['token']}")
        if status != 200 or not payload:
            print(f"  FAIL download {fmt}: {status}")
            return False
        print(f"  ok  export {fmt}: {len(payload):,} bytes")
    return True


def main() -> int:
    # Captions are Devanagari and accented Latin; a Windows console defaults
    # to a code page that can print neither.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--video", type=Path, action="append", required=True)
    parser.add_argument("--languages", default="same,en,hi,fr,de,nl")
    parser.add_argument("--no-burn", action="store_true", help="skip the MP4 burn-in export")
    parser.add_argument("--timeout", type=float, default=1800)
    args = parser.parse_args()

    status, info = call(args.base, "GET", "/api/system")
    if status != 200:
        print(f"Cannot reach {args.base}/api/system: {status} {info}")
        return 2
    print(f"install: auth={info['auth_mode']} whisper={info['whisper']} "
          f"translation={info['translation_engine']}/{info['translator_model']}")

    failures = 0
    for video in args.video:
        for language in args.languages.split(","):
            try:
                ok = run(args.base, video, language, not args.no_burn, args.timeout)
            except Exception as exc:  # noqa: BLE001
                print(f"  FAIL {exc}")
                ok = False
            failures += not ok
    print(f"\n{'ALL PASSED' if not failures else f'{failures} FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
