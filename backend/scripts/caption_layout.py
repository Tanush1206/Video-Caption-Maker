"""
Lay out caption texts the way the burn does, for comparing with the editor.

Reads JSON on stdin — {"style": <a GET /style response>, "texts": [...],
"width": <video px>, "height": <video px>} — and prints, per text, the lines,
the size and the painted rectangle as fractions of the frame. Used by
scripts/ui-check `layout-parity`; nothing in the app runs it.

    docker compose exec -T backend python scripts/caption_layout.py < request.json
"""

import json
import sys
from pathlib import Path

# Run as a file from backend/, where `app` is the package next to scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.caption_style import CaptionStyle  # noqa: E402
from app.services.caption_layout import layout_caption  # noqa: E402
from app.services.caption_style import default_style_fields  # noqa: E402


def main() -> None:
    request = json.load(sys.stdin)
    columns = default_style_fields()
    style = CaptionStyle(
        video_id=0, **{key: request["style"][key] for key in columns if key in request["style"]}
    )
    width, height = request["width"], request["height"]
    out = []
    for text in request["texts"]:
        layout = layout_caption(text, style, width, height)
        out.append({
            "lines": list(layout.text),
            "shrink": layout.shrink,
            "x": layout.x / width,
            "y": layout.y / height,
            "width": layout.width / width,
            "height": layout.height / height,
        })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
