"""
Check that captions are phrase-level, in every language (v1.0.8).

For videos of the same clip captioned in different languages, one of them
English, checks each against the limits below and exits non-zero if any is
broken. Everything goes through the API; the SRT is exported and read back
to compare its text with the captions'.

    python scripts/caption_quality.py --base http://localhost:3000 --english 12 13 14 15

  - at most 5% of captions are a single word;
  - no caption lasts longer than 7 s;
  - no two captions overlap;
  - the SRT holds every caption word, in order, nothing lost or repeated;
  - the caption count is within 30% of the English one.

It creates one SRT export per video and deletes it again; it never creates or
deletes videos.
"""

import argparse
import json
import re
import sys
import urllib.request

MAX_SINGLE = 0.05
MAX_SECONDS = 7.0
COUNT_TOLERANCE = 0.30


def call(base: str, method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{base}{path}", data=data, method=method,
        headers={"Content-Type": "application/json", "Origin": base},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
    return json.loads(raw) if raw and response.headers.get_content_type() == "application/json" else raw


def srt_words(base: str, video_id: int) -> list[str]:
    export = call(base, "POST", f"/api/videos/{video_id}/exports", {"format": "srt"})
    try:
        token = call(base, "POST", f"/api/exports/{export['id']}/download-token")["token"]
        body = call(base, "GET", f"/api/exports/{export['id']}/download?token={token}").decode("utf-8")
    finally:
        call(base, "DELETE", f"/api/exports/{export['id']}")
    lines = [
        line for line in body.splitlines()
        if line.strip() and not line.strip().isdigit() and not re.match(r"\d\d:\d\d:\d\d,\d{3} -->", line)
    ]
    return " ".join(lines).split()


def check(base: str, video_id: int, english_count: int | None) -> list[str]:
    video = call(base, "GET", f"/api/videos/{video_id}")
    captions = call(base, "GET", f"/api/videos/{video_id}/captions")["items"]
    name = f"{video_id} ({video['caption_language']})"
    problems = []
    count = len(captions)
    single = sum(1 for c in captions if len(c["text"].split()) == 1)
    longest = max((c["end_ms"] - c["start_ms"]) / 1000 for c in captions)
    overlaps = sum(1 for a, b in zip(captions, captions[1:]) if b["start_ms"] < a["end_ms"])
    if single > MAX_SINGLE * count:
        problems.append(f"{single} single-word captions of {count} ({100 * single / count:.0f}%)")
    if longest > MAX_SECONDS:
        problems.append(f"a caption lasts {longest:.1f}s")
    if overlaps:
        problems.append(f"{overlaps} overlapping captions")
    if srt_words(base, video_id) != [w for c in captions for w in c["text"].split()]:
        problems.append("the SRT's words differ from the captions'")
    ratio = f", {count / english_count:.2f} of English" if english_count else ""
    if english_count and abs(count - english_count) > COUNT_TOLERANCE * english_count:
        problems.append(f"{count} captions against English's {english_count}")
    print(f"{name}: {count} captions{ratio}, single {single}, longest {longest:.1f}s, overlaps {overlaps}"
          f" — {'OK' if not problems else 'FAIL: ' + '; '.join(problems)}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default="http://localhost:3000")
    parser.add_argument("--english", type=int, required=True, help="the English video's id")
    parser.add_argument("videos", type=int, nargs="+", help="the other languages' video ids")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    english = len(call(args.base, "GET", f"/api/videos/{args.english}/captions")["items"])
    failed = bool(check(args.base, args.english, None))
    for video_id in args.videos:
        failed |= bool(check(args.base, video_id, english))
    print("ALL PASSED" if not failed else "FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
