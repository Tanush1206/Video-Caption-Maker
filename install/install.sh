#!/usr/bin/env bash
# VideoCaptionMaker installer for macOS and Linux.
#
#   curl -fsSL https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download/install.sh | bash
#
# Checks Docker, disk space and the GPU, generates this install's secrets,
# pulls the images, starts everything, waits until it is healthy, and opens
# http://localhost:3000. Safe to run again: existing data and secrets are kept.
#
# Environment overrides (all optional):
#   VCM_HOME       install folder            (default: ~/.videocaptionmaker)
#   VCM_PORT       port for the web UI       (default: 3000, or the next free one)
#   VCM_GPU        1 = force GPU, 0 = force CPU (default: detect)
#   VCM_VERSION    image tag                 (default: latest)
#   VCM_REGISTRY   image registry            (default: ghcr.io/tanush1206)
#   VCM_BASE_URL   where to fetch the compose files and vcm from
#   VCM_NO_OPEN    1 = don't open the browser
set -euo pipefail

REPO_URL="https://github.com/Tanush1206/Video-Caption-Maker"
BASE_URL="${VCM_BASE_URL:-$REPO_URL/releases/latest/download}"
VCM_HOME="${VCM_HOME:-$HOME/.videocaptionmaker}"
PROJECT=vcm
CPU_NEED_GB=8    # images ~3 GB + speech and translation models ~4 GB, plus room
GPU_NEED_GB=12   # the CUDA image and large-v3 are bigger

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n  \033[31m✗ %s\033[0m\n' "$1"; shift; for line in "$@"; do printf '    %s\n' "$line"; done; echo; exit 1; }

OS="$(uname -s)"
bold "VideoCaptionMaker installer"
echo

# ── 1. Docker ───────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    if [ "$OS" = "Darwin" ]; then
        die "Docker is not installed." \
            "Install Docker Desktop: https://docs.docker.com/desktop/setup/install/mac-install/" \
            "Open it once so it finishes setting up, then run this installer again."
    else
        die "Docker is not installed." \
            "Install Docker Engine: https://docs.docker.com/engine/install/" \
            "  (quick way: curl -fsSL https://get.docker.com | sh)" \
            "Then run this installer again."
    fi
fi
if ! docker_err="$(docker info 2>&1 >/dev/null)"; then
    if printf '%s' "$docker_err" | grep -qi "permission denied"; then
        die "Docker is installed but this user can't use it." \
            "Run:  sudo usermod -aG docker \$USER" \
            "then log out and back in, and run this installer again."
    fi
    if [ "$OS" = "Darwin" ]; then
        die "Docker is installed but not running." "Start Docker Desktop, wait for it to say it's running, then try again."
    fi
    die "Docker is installed but not running." "Start it with:  sudo systemctl start docker" "then try again."
fi
if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 is missing." \
        "Install the compose plugin: https://docs.docker.com/compose/install/linux/"
fi
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) is running"

# ── 2. GPU ──────────────────────────────────────────────────────────────────
VARIANT=cpu
if [ "${VCM_GPU:-}" = "1" ]; then
    VARIANT=cuda
elif [ "${VCM_GPU:-}" != "0" ] && [ "$OS" = "Linux" ] && command -v nvidia-smi >/dev/null 2>&1 \
     && nvidia-smi >/dev/null 2>&1; then
    # A driver on the host is not enough: Docker needs the NVIDIA Container
    # Toolkit to hand the GPU to a container. Ask for one and see.
    if docker run --rm --gpus all busybox:1.37 true >/dev/null 2>&1; then
        VARIANT=cuda
    else
        warn "Found an NVIDIA GPU, but Docker can't use it yet."
        info "Install the NVIDIA Container Toolkit to enable it (much faster transcription):"
        info "https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
        info "Continuing with the CPU for now; run the installer again afterwards."
    fi
fi
if [ "$VARIANT" = "cuda" ]; then
    ok "NVIDIA GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo detected)"
else
    ok "No usable NVIDIA GPU — using the CPU (works everywhere, just slower)"
fi

# ── 3. Disk space ───────────────────────────────────────────────────────────
need=$CPU_NEED_GB; [ "$VARIANT" = "cuda" ] && need=$GPU_NEED_GB
docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
check_dir="$HOME"; [ -n "$docker_root" ] && [ -d "$docker_root" ] && check_dir="$docker_root"
free_gb="$(df -Pk "$check_dir" 2>/dev/null | awk 'NR==2 {printf "%d", $4/1024/1024}')"
if [ -n "$free_gb" ]; then
    if [ "$free_gb" -lt "$need" ]; then
        die "Not enough disk space: ${free_gb} GB free, about ${need} GB needed." \
            "Free some space (or prune old Docker data with: docker system prune) and try again."
    fi
    ok "${free_gb} GB free (about ${need} GB needed, more for your videos)"
fi

# ── 4. Files ────────────────────────────────────────────────────────────────
mkdir -p "$VCM_HOME/certs"
cd "$VCM_HOME"
FILES="docker-compose.prod.yml docker-compose.gpu.yml vcm"
sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
fetch() {
    if ! curl -fsSL --retry 3 "$BASE_URL/$1" -o "$1.tmp"; then
        rm -f ./*.tmp
        die "Couldn't download $1 from $BASE_URL" "Check your internet connection and try again."
    fi
}
# Everything is downloaded and checked against the release's SHA256SUMS
# before anything is replaced, so a truncated or altered file never lands.
for file in $FILES SHA256SUMS; do fetch "$file"; done
for file in $FILES; do
    expected="$(awk -v f="$file" '$2 == f || $2 == "*"f { print $1 }' SHA256SUMS.tmp)"
    if [ -z "$expected" ] || [ "$(sha256 "$file.tmp")" != "$expected" ]; then
        rm -f ./*.tmp
        die "$file didn't match the release's SHA256SUMS; nothing was installed." \
            "Try again. If it keeps happening, something between you and GitHub is altering downloads."
    fi
done
for file in $FILES; do mv "$file.tmp" "$file"; done
rm -f SHA256SUMS.tmp
chmod +x vcm
ok "Downloaded files match the release's SHA256SUMS"
ok "Installed to $VCM_HOME"

# ── 5. Secrets and settings (.env) ──────────────────────────────────────────
random_secret() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
    else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
set_env() {  # set_env KEY VALUE — replace or append, keeping everything else
    if grep -q "^$1=" .env 2>/dev/null; then
        sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
    else
        printf '%s=%s\n' "$1" "$2" >> .env
    fi
}

if [ ! -f .env ]; then
    umask 077
    {
        echo "# Generated by the installer. Keep this file private; it is never uploaded."
        echo "POSTGRES_PASSWORD=$(random_secret)"
        echo "JWT_SECRET_KEY=$(random_secret)"
    } > .env
    umask 022
    ok "Generated this install's secrets"
else
    ok "Kept existing settings and secrets"
fi
chmod 600 .env

port="${VCM_PORT:-$(grep '^VCM_PORT=' .env | cut -d= -f2 || true)}"
if [ -z "$port" ]; then
    port=3000
    # Our own stack already on 3000 is fine; anything else, move along.
    if ! port_free 3000 && ! docker compose -p "$PROJECT" ps --status running 2>/dev/null | grep -q frontend; then
        for candidate in 3001 3002 3003 3004 3005 3080 8080; do
            if port_free "$candidate"; then port=$candidate; break; fi
        done
        warn "Port 3000 is taken; using $port instead"
    fi
fi
set_env VCM_PORT "$port"
set_env VCM_VARIANT "$VARIANT"
version="${VCM_VERSION:-$(grep '^VCM_VERSION=' .env | cut -d= -f2 || true)}"
set_env VCM_VERSION "${version:-latest}"
[ -n "${VCM_REGISTRY:-}" ] && set_env VCM_REGISTRY "$VCM_REGISTRY"

# ── 6. vcm command on PATH ──────────────────────────────────────────────────
bin_dir="$HOME/.local/bin"
mkdir -p "$bin_dir"
ln -sf "$VCM_HOME/vcm" "$bin_dir/vcm"
case ":$PATH:" in
    *":$bin_dir:"*) ok "The 'vcm' command is ready" ;;
    *) warn "Add $bin_dir to your PATH to use 'vcm' anywhere (or run $VCM_HOME/vcm)" ;;
esac

# ── 7. Pull, start, wait ────────────────────────────────────────────────────
echo
bold "Downloading the app (first time: a few GB, this can take a while)…"
"$VCM_HOME/vcm" pull || die "Couldn't download the images." \
    "Check your internet connection and run the installer again — it resumes."
bold "Starting…"
"$VCM_HOME/vcm" up || die "The app failed to start." "See what happened with:  vcm logs"

url="http://localhost:$port"
printf '  Waiting for it to be ready'
for _ in $(seq 1 120); do
    if curl -fsS "$url/api/health" >/dev/null 2>&1; then
        echo; ok "Running at $url"; break
    fi
    printf '.'; sleep 3
done
if ! curl -fsS "$url/api/health" >/dev/null 2>&1; then
    echo
    die "It started but isn't answering yet." "Give it a minute and open $url, or check:  vcm status  /  vcm logs"
fi

if [ "${VCM_NO_OPEN:-0}" != "1" ]; then
    if [ "$OS" = "Darwin" ]; then open "$url" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true; fi
fi

echo
bold "Done. Open $url"
info "The first video also downloads the speech model (0.5–3 GB, once)."
info "vcm start | stop | update | status | logs | uninstall"
echo
