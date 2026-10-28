"""
Write the burn documents the current code makes for a grid of placed styles.

    docker compose exec backend python scripts/burn_reference.py tests/data/burn-1.1.1.json

Made with v1.1.1, before a caption's position became an anchor by alignment
(v1.2.0): tests/test_caption_anchor.py converts these styles as the migration
does and checks the new code burns every document byte for byte the same.
Each document is stored as the SHA-256 of its Dialogue lines, which keeps
360 of them to a few kilobytes; `document()` rebuilds one to compare.
"""

import hashlib
import json
import sys
from pathlib import Path

from app.models.caption import Caption
from app.services import subtitles
from app.services.caption_style import default_style_fields
from app.models.caption_style import CaptionStyle

TEXTS = [
    "Hi there",
    "Finally, stir everything together until the soup is completely smooth, then serve it hot with fresh bread",
    "अंत में, सब कुछ चिकना होने तक मिलाएँ और इसे ताज़ी रोटी के साथ परोसें",
    "A line I broke\nby hand, and a second one",
]
FRAMES = [[1920, 1080], [1080, 1920], [720, 720]]
LOOKS = {
    "plain": {},
    "boxed": {"box_opacity": 0.7, "box_padding": 20, "font_size": 64, "line_style": "stacked", "words_per_line": 3, "max_lines": 4},
}


def styles() -> dict[str, dict]:
    out = {}
    for alignment in ("left", "center", "right"):
        for x in (0.0, 0.25, 0.5, 0.75, 1.0):
            for width in (None, 0.2, 0.5, 0.94):
                for look, fields in LOOKS.items():
                    name = f"{alignment}-x{x}-w{width}-{look}"
                    out[name] = {**fields, "alignment": alignment, "pos_x": x, "pos_y": 0.8, "box_width": width}
    return out


def document(overrides: dict, width: int, height: int) -> str:
    """The Dialogue lines of one style's burn, as the reference hashes them."""
    captions = [
        Caption(video_id=1, sequence=i, start_ms=i * 1000, end_ms=i * 1000 + 900, text=t, confidence=-0.1)
        for i, t in enumerate(TEXTS)
    ]
    style = CaptionStyle(video_id=1, **{**default_style_fields(), **overrides})
    doc = subtitles.to_ass(captions, style, width, height)
    return "\n".join(line for line in doc.splitlines() if line.startswith("Dialogue:"))


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main(path: str) -> None:
    documents = {}
    grid = styles()
    for name, overrides in grid.items():
        for width, height in FRAMES:
            documents[f"{name}@{width}x{height}"] = digest(document(overrides, width, height))
    Path(path).write_text(
        json.dumps({"styles": grid, "frames": FRAMES, "documents": documents}, indent=0),
        encoding="utf-8",
    )
    print(f"{len(documents)} documents -> {path}")


if __name__ == "__main__":
    main(sys.argv[1])
