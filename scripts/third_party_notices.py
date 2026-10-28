"""
Write THIRD_PARTY_NOTICES.md from what the images actually contain.

    python scripts/third_party_notices.py --image vcm-test/backend:1.1.1-cuda

Reads the Python packages (name, version, licence) and the FFmpeg and Debian
facts from a built backend image (CUDA, so NVIDIA's libraries are listed too),
and the npm production packages from frontend/package-lock.json and
frontend/node_modules, the same way the frontend image collects their
licence files (frontend/scripts/collect-licenses.js). Run it again whenever
dependencies, models or the base images change. Standard library only.
"""

import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/Tanush1206/Video-Caption-Maker"

PYTHON_LIST = r"""
import json
from importlib import metadata

def licence(dist):
    m = dist.metadata
    if m.get("License-Expression"):
        return m["License-Expression"]
    found = [c.split(" :: ")[-1] for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
    if found:
        return "; ".join(found)
    text = (m.get("License") or "").strip()
    return text if text and len(text) < 80 and "\n" not in text else "see its licence file"

rows = {(d.metadata["Name"], d.version): licence(d) for d in metadata.distributions(path=["/opt/venv/lib/python3.11/site-packages"])}
print(json.dumps(sorted([n, v, l] for (n, v), l in rows.items())))
"""

IMAGE_FACTS = r"""
ffmpeg -version | head -1 | cut -d' ' -f3
ffmpeg -hide_banner -buildconf | tr ' ' '\n' | grep -E 'enable-(gpl|version3|nonfree|libx264|libx265)' | tr '\n' ' '; echo
dpkg-query -W -f='${source:Package}\n' | sort -u | wc -l
cat /etc/debian_version
"""

NPM_LIST = """
const { productionPackages, licenceOf } = require("./scripts/collect-licenses.js");
const path = require("node:path");
const rows = productionPackages(process.cwd()).map((dir) => {
  const m = require(path.join(dir, "package.json"));
  return [m.name, m.version, licenceOf(m)];
});
console.log(JSON.stringify(rows));
"""

MODELS = [
    ("Whisper small", "Systran/faster-whisper-small", "MIT", "OpenAI's Whisper, converted by Systran"),
    ("Whisper large-v3", "Systran/faster-whisper-large-v3", "MIT", "OpenAI's Whisper, converted by Systran"),
    ("Whisper large-v3-turbo", "mobiuslabsgmbh/faster-whisper-large-v3-turbo", "MIT",
     "OpenAI's Whisper, converted by Mobius Labs (now served from dropbox-dash/faster-whisper-large-v3-turbo)"),
    ("Hinglish speech", "Oriserve/Whisper-Hindi2Hinglish-Apex", "Apache-2.0", "Oriserve, fine-tuned from Whisper"),
    ("Hindi transliteration", "ai4bharat/IndicXlit", "MIT", "AI4Bharat"),
    ("Translation", "jncraton/m2m100_1.2B-ct2-int8 and m2m100_418M-ct2-int8", "MIT",
     "Meta's M2M100, converted to CTranslate2 by jncraton"),
    ("Search", "sentence-transformers/all-MiniLM-L6-v2", "Apache-2.0", "sentence-transformers"),
]

# Packages whose metadata names no licence, read from their licence file.
LICENCE_FROM_FILE = {"setuptools": "MIT"}

BUNDLED_FONTS = "Anton, Barlow Condensed, Bebas Neue, Lato, Noto Sans (Latin, Devanagari, Bengali, Tamil, Malayalam), Poppins"


def run(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True, cwd=cwd).stdout


def table(rows: list[list[str]], header: tuple[str, ...]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(cell.replace("|", "/") for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--image", required=True, help="a built backend image, CUDA variant")
    parser.add_argument("--out", default=str(ROOT / "THIRD_PARTY_NOTICES.md"))
    args = parser.parse_args()

    python_rows = json.loads(run(
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "/opt/venv/bin/python", args.image, "-c", PYTHON_LIST
    ))
    ffmpeg_version, ffmpeg_flags, debian_sources, debian_version = run(
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "sh", args.image, "-c", IMAGE_FACTS
    ).strip().splitlines()
    npm_rows = json.loads(run("node", "-e", NPM_LIST, cwd=ROOT / "frontend"))
    # The compiler binary is per platform; the image has the Linux one.
    npm_rows = [r for r in npm_rows if not r[0].startswith("@next/swc-")]
    npm_rows.append(["@next/swc-linux-* (the image's Linux builds)", "as installed", "MIT"])
    # frontend/Dockerfile removes sharp and its binaries before the build: not shipped.
    npm_rows = [r for r in npm_rows if r[0] != "sharp" and not r[0].startswith("@img/")]

    python_rows = [[n, v, LICENCE_FROM_FILE.get(n, l)] for n, v, l in python_rows]
    nvidia = [r for r in python_rows if r[0].startswith("nvidia-")]
    mpl = sorted({r[0] for r in python_rows if "MPL" in r[2] or "Mozilla" in r[2]})

    text = f"""# Third-party notices

VideoCaptionMaker's own code is under the MIT licence ([LICENSE](LICENSE)).
It is distributed as Docker images (GHCR) and install scripts, and it uses
the software, models and fonts below under their own licences.

**Full licence texts** are inside every image, in `/licenses`:
- `LICENSE` and this file;
- `python/<package>/`: each Python package's own licence files;
- `python-runtime/`: Python itself (PSF-2.0);
- `fonts/`: the bundled fonts' SIL Open Font Licence texts;
- `npm/<package>/` and `node/` (frontend image): each npm package's
  licence files, and Node.js's;
- `SOURCES-debian.txt` (backend) and `SOURCES-alpine.txt` (frontend):
  every operating-system package's source, below.

Debian's licence text for each of its packages is in the backend image at
`/usr/share/doc/<package>/copyright`.

To read one, for example:

```
docker run --rm --entrypoint cat ghcr.io/tanush1206/video-caption-maker-backend:latest-cpu /licenses/SOURCES-debian.txt
```

*Generated by `scripts/third_party_notices.py` from the images it describes.*

## Source code for GPL and LGPL components (written offer)

The backend images are built on Debian {debian_version} and contain
{debian_sources} Debian source packages, several of them under the GPL or
LGPL (FFmpeg among them, below). The frontend image is built on Alpine Linux,
whose BusyBox and GCC runtime libraries are GPL or LGPL.

**Each image lists its operating-system packages at their exact versions,
with a link to that exact source:**
- backend: `/licenses/SOURCES-debian.txt`, one line per source package, each
  linking to the source on snapshot.debian.org, Debian's permanent archive;
- frontend: `/licenses/SOURCES-alpine.txt`, linking to Alpine's build recipes
  and source mirror.

For at least three years after each release, anyone who received one of these
images may also ask for the complete corresponding source of any GPL or LGPL
component in it. Ask in a GitHub issue ({REPO}/issues), naming the image
and the package, and it will be provided at no more than the cost of
providing it.

## FFmpeg

The backend images run Debian's FFmpeg {ffmpeg_version}, which is built with
`{ffmpeg_flags.strip()}`. With the GPL parts (libx264 and libx265) the FFmpeg
programs are under the **GNU GPL, version 2 or later**. VideoCaptionMaker runs
them as separate programs (`ffmpeg`, `ffprobe`); its own code is not derived
from them. Source: the `ffmpeg`, `x264` and `x265` lines in
`/licenses/SOURCES-debian.txt`.

## Models

Not part of any image. Each is downloaded from Hugging Face the first time it
is needed, onto the user's computer, under its own licence:

{table([list(m) for m in MODELS], ("Use", "Repository", "Licence", "By"))}

## Fonts

- **Bundled in both images** (`/usr/share/fonts/truetype/vcm/` in the
  backend, `/app/public/fonts/` in the frontend): {BUNDLED_FONTS}. SIL Open
  Font License 1.1; the texts are next to the fonts and in `/licenses/fonts/`.
- **From Debian** (backend): DejaVu (Bitstream Vera licence and public
  domain), Liberation (SIL OFL 1.1) and Noto Core (SIL OFL 1.1); see
  `/usr/share/doc/fonts-*/copyright`.
- **The Google Fonts library** offered in the style panel is not part of any
  image. A font is downloaded from the `google/fonts` repository, at a fixed
  commit, the first time a user picks it. Of the 1,832 fonts in the catalogue,
  1,792 are under the SIL OFL 1.1, 35 under Apache-2.0 and 5 under the Ubuntu
  Font Licence 1.0; each font's licence is in its folder in that repository.

## NVIDIA CUDA libraries (CUDA image only)

{table(nvidia, ("Package", "Version", "Licence"))}

Distributed with the application under NVIDIA's licence terms for these
runtime libraries; the terms are in `/licenses/python/nvidia_*`.

## Python packages (backend images)

{len(python_rows)} packages in the CUDA image; the CPU image has the same list
without the NVIDIA ones. Python itself: PSF-2.0.

{table(python_rows, ("Package", "Version", "Licence"))}

Packages under the Mozilla Public License 2.0 ({", ".join(mpl)}) are
distributed unmodified; their source is on PyPI (`https://pypi.org/project/<name>/`).

## npm packages (frontend image)

Production dependencies; their code is in the server and in the JavaScript
the app's pages load.

{table(sorted(npm_rows), ("Package", "Version", "Licence"))}

`caniuse-lite` is browser-support data from caniuse.com by Alexis Deveria,
under CC BY 4.0. Node.js itself: MIT, with its bundled components under their
own licences (`/licenses/node/LICENSE`).
"""
    Path(args.out).write_text(text, encoding="utf-8")
    print(f"wrote {args.out}: {len(python_rows)} Python packages, {len(npm_rows)} npm packages")


if __name__ == "__main__":
    main()
