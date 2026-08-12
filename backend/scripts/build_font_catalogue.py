"""
Build the Google Fonts catalogue that ships with the app.

Run occasionally, by hand, and commit the result:

    docker compose exec backend python scripts/build_font_catalogue.py

Why a generated, committed file rather than calling Google at runtime:

  - Listing fonts is then a local read. The picker does not need the network,
    GitHub's rate limit, or a cache-warming step on a cold start.
  - It is reviewable. A diff shows exactly which families appeared or vanished
    between runs, which is the only way anyone would notice Google removing one.
  - The font *bytes* are still fetched on demand — this is an index, roughly
    200KB, not a gigabyte of TTFs.

Two sources, because neither alone is enough:

  - fonts.google.com/metadata/fonts gives the human-facing catalogue: category,
    subsets, and the variable axes a family exposes.
  - The google/fonts git tree gives the actual file paths and byte sizes, which
    the metadata does not contain.

Only families with a real static `-Regular.ttf` are included. A variable-only
family would have libass take the default instance and synthesise a fake bold
while the browser interpolated a real one along the weight axis — the preview
disagreeing with the export, which is the failure this whole area exists to
prevent.
"""

from __future__ import annotations

import json
import re
import struct
import urllib.request
from pathlib import Path

METADATA_URL = "https://fonts.google.com/metadata/fonts"
TREE_URL = "https://api.github.com/repos/google/fonts/git/trees/main?recursive=1"
RAW = "https://raw.githubusercontent.com/google/fonts/main/"

OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "google_fonts.json"

# Anything bigger than this is a CJK or historic-script family whose single
# file runs to tens of megabytes. They are excluded rather than offered and
# left to time out on a slow connection — and none of them are caption faces.
MAX_BYTES = 6_000_000


def fetch(url: str, *, accept: str | None = None) -> bytes:
    headers = {"User-Agent": "VideoCaptionMaker font catalogue builder"}
    if accept:
        headers["Accept"] = accept
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=headers), timeout=120
    ).read()


def google_metadata() -> dict[str, dict]:
    raw = fetch(METADATA_URL).decode("utf-8")
    # The endpoint prefixes an XSSI guard before the JSON body.
    payload = json.loads(raw[raw.index("{") :])
    return {f["family"]: f for f in payload["familyMetadataList"]}


def font_tree() -> list[dict]:
    payload = json.loads(fetch(TREE_URL, accept="application/vnd.github+json").decode())
    if payload.get("truncated"):
        raise SystemExit("GitHub truncated the tree; this script needs the whole listing")
    return payload["tree"]


def win_span(data: bytes) -> tuple[int, float] | None:
    """
    unitsPerEm and (usWinAscent + usWinDescent) / unitsPerEm.

    This ratio is not decoration. libass sizes a font so that the win span
    equals the requested `Fontsize`, while CSS `font-size` means the em square,
    so the browser must divide by it to draw the caption at the size the export
    will use. Measured, not assumed — see the learning guide.
    """
    try:
        count = struct.unpack(">H", data[4:6])[0]
        tables: dict[str, int] = {}
        for i in range(count):
            off = 12 + i * 16
            tag = data[off : off + 4].decode("latin-1", "replace")
            tables[tag] = struct.unpack(">II", data[off + 8 : off + 16])[0]
        head, os2 = tables["head"], tables["OS/2"]
        upem = struct.unpack(">H", data[head + 18 : head + 20])[0]
        asc, desc = struct.unpack(">HH", data[os2 + 74 : os2 + 78])
        if not upem:
            return None
        return upem, (asc + desc) / upem
    except (KeyError, struct.error, IndexError):
        return None


def main() -> None:
    print("fetching Google's family metadata…")
    meta = google_metadata()
    print(f"  {len(meta)} families")

    print("fetching the google/fonts file tree…")
    tree = font_tree()
    ttfs = {t["path"]: t.get("size", 0) for t in tree if t["path"].endswith(".ttf")}
    print(f"  {len(ttfs)} ttf files")

    # slug -> {weight file suffix: (path, size)}
    by_slug: dict[str, dict[str, tuple[str, int]]] = {}
    for path, size in ttfs.items():
        parts = path.split("/")
        if len(parts) < 3 or parts[0] not in {"ofl", "apache", "ufl"}:
            continue
        name = parts[-1]
        # Variable files carry their axes in brackets: Roboto[wdth,wght].ttf
        if "[" in name:
            continue
        match = re.match(r"^(.+)-(Regular|Bold)\.ttf$", name)
        if not match:
            continue
        by_slug.setdefault(parts[1], {})[match.group(2)] = (path, size)

    entries = []
    skipped_variable = skipped_big = skipped_nostatic = 0

    for family, info in sorted(meta.items()):
        slug = re.sub(r"[^a-z0-9]", "", family.lower())
        files = by_slug.get(slug)
        if not files or "Regular" not in files:
            if info.get("axes"):
                skipped_variable += 1
            else:
                skipped_nostatic += 1
            continue

        regular_path, regular_size = files["Regular"]
        if regular_size > MAX_BYTES:
            skipped_big += 1
            continue

        bold = files.get("Bold")
        entries.append(
            {
                "key": slug,
                "family": family,
                "category": info.get("category", "").replace("SANS_SERIF", "sans-serif").lower(),
                "regular": regular_path,
                "bold": bold[0] if bold else None,
                "bytes": regular_size + (bold[1] if bold else 0),
            }
        )

    print(
        f"\nkept {len(entries)}  |  skipped: {skipped_variable} variable-only, "
        f"{skipped_big} oversized, {skipped_nostatic} without a static regular"
    )
    total = sum(e["bytes"] for e in entries)
    print(f"total if every one were downloaded: {total / 1e6:.0f} MB")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"base_url": RAW, "fonts": entries}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
