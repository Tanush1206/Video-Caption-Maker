"""
Burn one frame the way the export does and compare it with the editor's preview.

Reads JSON on stdin:

    {"style": <a GET /style response>, "text": "...", "video_id": 123,
     "at_ms": 1500, "width": 820, "height": 461, "preview_png": "<base64>"}

and prints, as JSON, what was drawn in each: the bounding box of everything
that differs from the frame underneath, and how many pixels are the text
colour, the outline colour, the shadow colour and the box. The frame is the
video's own, so the source should be a flat colour (scripts/ui-check
`style-parity` makes one). The burn goes through `rendering._filter_chain`,
the export's own scale-then-`ass` chain, at the preview's size: an export at
that height. Used by scripts/ui-check `style-parity`; nothing in the app runs
it.

    docker compose exec -T backend python scripts/style_parity.py < request.json
"""

import asyncio
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

# Run as a file from backend/, where `app` is the package next to scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import engine  # noqa: E402
from app.models.caption import Caption  # noqa: E402
from app.models.caption_style import CaptionStyle  # noqa: E402
from app.services import rendering, storage, subtitles  # noqa: E402
from app.services.caption_style import default_style_fields  # noqa: E402

# A pixel this far from the frame underneath, in its most-changed channel,
# was drawn. Below it is compression noise and the edge of anti-aliasing.
DRAWN = 40
# A drawn pixel this close to a colour, in every channel, counts as it.
CLOSE = 48
# Not looked at, round the edge: the editor's frame has rounded corners.
EDGE = 16


def rgb(command: list[str]) -> bytes:
    return subprocess.run(command, capture_output=True, check=True, timeout=120).stdout


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def measure(frame: bytes, background: bytes, width: int, height: int, style: dict) -> dict:
    """What was drawn over `background`, and of which colours."""
    text = hex_rgb(style["text_color"])
    outline = hex_rgb(style["outline_color"])
    shadow = hex_rgb(style["shadow_color"])
    box = hex_rgb(style["box_color"])
    opacity = style["box_opacity"]
    counts = {"drawn": 0, "text": 0, "outline": 0, "shadow": 0, "box": 0}
    xs, ys = [], []
    mask = set()
    for y in range(EDGE, height - EDGE):
        row = y * width * 3
        for x in range(EDGE, width - EDGE):
            i = row + x * 3
            px = frame[i:i + 3]
            bg = background[i:i + 3]
            if max(abs(px[c] - bg[c]) for c in range(3)) < DRAWN:
                continue
            counts["drawn"] += 1
            xs.append(x)
            ys.append(y)
            mask.add((x, y))
            near = lambda colour: all(abs(px[c] - colour[c]) < CLOSE for c in range(3))  # noqa: E731
            if near(text):
                counts["text"] += 1
            elif opacity > 0 and near(tuple(round(box[c] * opacity + bg[c] * (1 - opacity)) for c in range(3))):
                counts["box"] += 1
            elif near(outline):
                counts["outline"] += 1
            elif near(shadow):
                counts["shadow"] += 1
    bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1] if xs else None
    return {"bbox": bbox, **counts, "mask": mask}


async def source_of(video_id: int) -> Path:
    from sqlalchemy import text

    # The dev engine echoes its SQL to stdout, where the answer goes.
    engine.echo = False
    async with engine.connect() as connection:
        path = (await connection.execute(
            text("select storage_path from videos where id = :id"), {"id": video_id}
        )).scalar_one()
    return storage.resolve(path)


def main() -> None:
    request = json.load(sys.stdin)
    width, height = request["width"], request["height"]
    columns = default_style_fields()
    style = CaptionStyle(video_id=0, **{k: request["style"][k] for k in columns if k in request["style"]})
    caption = Caption(video_id=0, sequence=0, start_ms=0, end_ms=600_000, text=request["text"])
    source = asyncio.run(source_of(request["video_id"]))
    at = f"{request['at_ms'] / 1000:.3f}"
    raw = ["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]

    with tempfile.TemporaryDirectory() as scratch:
        ass = Path(scratch) / "captions.ass"
        ass.write_text(subtitles.to_ass([caption], style, width, height), encoding="utf-8")
        chain = rendering._filter_chain(ass, (width, height))
        burned = rgb(["ffmpeg", "-v", "error", "-ss", at, "-i", str(source), "-vf", chain, *raw])
        background = rgb(["ffmpeg", "-v", "error", "-ss", at, "-i", str(source),
                          "-vf", f"scale={width}:{height}:flags=lanczos", *raw])
        png = Path(scratch) / "preview.png"
        png.write_bytes(base64.b64decode(request["preview_png"]))
        preview = rgb(["ffmpeg", "-v", "error", "-i", str(png), "-vf", f"scale={width}:{height}", *raw])

    if request.get("save"):
        # Both frames as PNGs, to look at a disagreement.
        for name, data in (("burn", burned), ("preview", preview)):
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
                 "-s", f"{width}x{height}", "-i", "-", f"{request['save']}-{name}.png"],
                input=data, check=True, timeout=60,
            )
    burn = measure(burned, background, width, height, request["style"])
    seen = measure(preview, background, width, height, request["style"])
    # Overlap of what was drawn, each grown by a pixel: Chrome and libass
    # anti-alias the same outline a pixel apart.
    grow = lambda mask: {(x + dx, y + dy) for x, y in mask for dx in (-1, 0, 1) for dy in (-1, 0, 1)}  # noqa: E731
    a, b = grow(burn.pop("mask")), grow(seen.pop("mask"))
    overlap = len(a & b) / max(1, len(a | b))
    print(json.dumps({"burn": burn, "preview": seen, "overlap": round(overlap, 3)}))


if __name__ == "__main__":
    main()
