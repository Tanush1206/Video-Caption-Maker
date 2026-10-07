# VideoCaptionMaker

Captions for your videos, made on your own computer. Upload a video, choose
the caption language, export it with the captions burned in, or as subtitle
files. Speech recognition (Whisper) and translation (M2M100) run locally on
your CPU or NVIDIA GPU. There's no account and no cloud service, and your
video never leaves the machine.

## Install

You need [Docker](https://docs.docker.com/get-docker/), which is free:
Docker Desktop on Windows and macOS, Docker Engine on Linux. Make sure it's
running, then paste one line into a terminal.

**macOS / Linux**

```bash
curl -fsSL https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download/install.ps1 | iex
```

The installer:

1. checks that Docker is running and that there's enough disk space;
2. checks for a usable NVIDIA GPU;
3. generates this install's private settings;
4. downloads the app;
5. starts it, waits until it's healthy, and opens
   **http://localhost:3000**.

Running it again is safe. Your videos and settings are kept.

## Use

1. **Upload**: drop a video (`.mp4 .mov .mkv .webm .avi .m4v`).
2. **Language**: keep "Same as spoken", or pick English, Hindi, French,
   German or Dutch. The spoken language is detected automatically.
3. **Export**: download the video with captions burned in (MP4), or the
   subtitles as `.srt` / `.vtt`.

Editing captions, retiming them on the waveform, styling them and searching
the transcript by meaning are all optional. They're on each video's page,
below the export step.

## Requirements

|  | Minimum | Recommended |
|---|---|---|
| OS | Windows 10/11 (WSL 2), macOS 12+, any 64-bit Linux | |
| Memory | 8 GB RAM | 16 GB RAM |
| Disk | 8 GB free | 20 GB free, plus room for your videos |
| GPU | none, the CPU works | NVIDIA with 6 GB+ VRAM and a current driver |

The app picks models to fit the machine. You can change the speech model in
**Settings**.

| Hardware | Speech model | Translation model |
|---|---|---|
| NVIDIA GPU, 6 GB+ VRAM | Whisper large-v3 (fp16) | M2M100 1.2B |
| CPU, 12 GB+ RAM | Whisper large-v3-turbo (int8) | M2M100 1.2B |
| CPU under 12 GB RAM | Whisper small (int8) | M2M100 418M |

### What gets downloaded

| What | Size | When |
|---|---|---|
| App (CPU) | about 1.2 GB download, 4 GB on disk | at install |
| App (NVIDIA) | about 2.6 GB download, 8 GB on disk | at install |
| Speech model | 0.5 GB (small) to 3 GB (large-v3) | first video |
| Translation model | 0.5–1.3 GB | first translated video |
| Search model | 90 MB | first video |

Models are downloaded once and kept. While one downloads, the video's page
shows its size and progress.

## Everyday commands

The installer adds a `vcm` command. Open a new terminal after installing.

| Command | Does |
|---|---|
| `vcm start` | start the app and open it in the browser |
| `vcm stop` | stop it (your videos are kept) |
| `vcm status` | show what's running and whether it's healthy |
| `vcm logs` | follow the logs (`vcm logs worker` for just the processing) |
| `vcm update` | download the newest version and restart into it |
| `vcm uninstall` | remove the app; it asks before deleting any of your videos |

The app restarts with Docker, so after a reboot it's back once Docker is
running.

## Optional: Gemini

Nothing in the core flow needs the internet once the models are downloaded.
If you paste a [Gemini API key](https://aistudio.google.com/apikey) into
**Settings**, captions are translated with Gemini instead (often more
natural), and Search can write answers to questions about a video. With a
key, caption text (never the video or audio) is sent to Google. If Gemini
fails (no network, quota, a bad key), translation falls back to the local
model automatically and the video says so.

## Troubleshooting

**"Docker is not running".** Start Docker Desktop and wait for "Engine
running", or on Linux run `sudo systemctl start docker`. Then run the
command again.

**"permission denied" on Linux.** Run `sudo usermod -aG docker $USER`, log
out and back in.

**I have an NVIDIA GPU but it says CPU.**
- On Windows, update the NVIDIA driver and Docker Desktop (WSL 2 backend).
- On Linux, install the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).

Then run the installer again; it switches over and keeps your data. Settings
shows what the app detected.

**Port 3000 is already in use.** The installer picks the next free port and
tells you which. To choose one yourself, set `VCM_PORT=8080` before running
the installer.

**The model download fails, or downloads fail with a certificate error.**
Check the connection and process the video again; downloads resume. On
networks that inspect TLS (some antivirus and corporate proxies), put your
proxy's root certificate (`.crt`) in the `certs` folder of the install, then
run `vcm restart`:
- Windows: `%LOCALAPPDATA%\VideoCaptionMaker`
- macOS and Linux: `~/.videocaptionmaker`

**"Ran out of memory".** Choose a smaller speech model in Settings. On
Windows and macOS you can also give Docker Desktop more memory (Settings →
Resources).

**Transcription is slow.** On a CPU, expect roughly real time, give or take,
with the default model. Settings → Speech recognition → Small is several
times faster, with lower accuracy.

**Anything else.** Run `vcm logs`, and `vcm status` to see which part isn't
healthy.

## Uninstall

`vcm uninstall` stops and removes the app. It deletes your videos, captions
and downloaded models only if you type `DELETE` when asked.

## Development

The dev stack bind-mounts the source with hot reload:

```bash
cp .env.example .env            # dev settings; never commit .env
docker compose up               # CPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up   # NVIDIA GPU
docker compose exec backend alembic upgrade head
docker compose exec backend python -m pytest      # uses the dev database
docker compose exec frontend npm run lint
python scripts/e2e.py --base http://localhost:8000 --video clip.mp4   # end to end
```

- Frontend (Next.js 14): `frontend/`. Backend (FastAPI, Celery): `backend/`.
- Production images: `backend/Dockerfile` (`VARIANT=cpu|cuda`, built from the
  repo root) and `frontend/Dockerfile`. Both use the `runtime` target.
- Releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which
  pushes the images to GHCR and attaches the installers to a GitHub Release.
- `AUTH_MODE=accounts` (backend) with `NEXT_PUBLIC_AUTH_MODE=accounts`
  (frontend build) turns registration, login and Google sign-in back on for
  a hosted deployment.
- Architecture: [docs/architecture.md](docs/architecture.md). History:
  [docs/roadmap.md](docs/roadmap.md).

## Licences of the models

| Model | Licence |
|---|---|
| Whisper (OpenAI), via faster-whisper | MIT |
| M2M100 (Meta) | MIT |
| all-MiniLM-L6-v2 | Apache-2.0 |
