#!/usr/bin/env bash
# This commit on one architecture, as a user would get it (v1.4.0): its CPU
# images built natively on this runner and pushed to a local registry, the
# real install.sh run against this commit's files served as a release, every
# container checked to run as this architecture, and a short transcription
# timed (scripts/ci_smoke.py). Run by .github/workflows/arm64.yml on an
# arm64 and an amd64 runner, so the times sit side by side.
#
#   bash scripts/ci_arch_check.sh <amd64|arm64> <out.json>
set -euo pipefail

arch="$1"; out="$2"
tmp="${RUNNER_TEMP:-$(mktemp -d)}"
registry=localhost:5000
step() { echo; echo "── $*"; }
# Runs a command with its output on stderr; prints how long it took.
seconds() { local s=$SECONDS; "$@" >&2; echo $((SECONDS - s)); }

step "Tools: espeak-ng for the test speech, ffmpeg to make it a video"
sudo apt-get update -qq
sudo apt-get install -y -qq espeak-ng ffmpeg >/dev/null

step "A local registry, so the installer pulls this commit's images"
docker run -d --name registry -p 127.0.0.1:5000:5000 \
    registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e

step "Build this commit's images natively ($arch)"
backend_s=$(seconds docker buildx build --load --target runtime --build-arg VARIANT=cpu --build-arg VERSION=ci \
    -f backend/Dockerfile -t "$registry/video-caption-maker-backend:ci-cpu" .)
frontend_s=$(seconds docker buildx build --load --target runtime --build-arg VERSION=ci --build-context repo=. \
    -f frontend/Dockerfile -t "$registry/video-caption-maker-frontend:ci" frontend)
docker push -q "$registry/video-caption-maker-backend:ci-cpu"
docker push -q "$registry/video-caption-maker-frontend:ci"

step "Serve this commit's files as a release"
mkdir -p "$tmp/release"
cp docker-compose.prod.yml docker-compose.gpu.yml install/vcm "$tmp/release/"
(cd "$tmp/release" && sha256sum docker-compose.prod.yml docker-compose.gpu.yml vcm > SHA256SUMS)
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$tmp/release" > /dev/null 2>&1 &

step "Install"
VCM_BASE_URL=http://127.0.0.1:8000 VCM_HOME="$tmp/vcm" VCM_NO_OPEN=1 \
VCM_REGISTRY="$registry" VCM_VERSION=ci \
    bash install/install.sh 2>&1 | tee "$tmp/install.log"
if [ "$arch" = arm64 ]; then
    grep -q "the app runs natively" "$tmp/install.log"
    if grep -qi "emulat\|rosetta" "$tmp/install.log"; then echo "The installer still talks about emulation" >&2; exit 1; fi
fi

step "Every container runs as $arch"
for c in backend worker frontend postgres redis chromadb; do
    got="$(docker image inspect --format '{{.Architecture}}' "$(docker inspect --format '{{.Image}}' "vcm-$c-1")")"
    echo "$c: $got"; [ "$got" = "$arch" ]
done

step "The app answers, and vcm stop and up work"
port="$(grep '^VCM_PORT=' "$tmp/vcm/.env" | cut -d= -f2)"
curl -fsS "http://localhost:$port/api/health"; echo
vcm="$tmp/vcm/vcm"
"$vcm" status
"$vcm" stop
"$vcm" up
for _ in $(seq 1 120); do curl -fsS "http://localhost:$port/api/health" > /dev/null 2>&1 && break; sleep 3; done
curl -fsS "http://localhost:$port/api/health"; echo

step "A short transcription, timed"
espeak-ng -v en -s 140 -w "$tmp/en.wav" \
    "Hello and welcome. This video shows how to make captions for any video on your own computer."
espeak-ng -v hi -s 130 -w "$tmp/hi.wav" \
    "नमस्ते दोस्तों। आज हम सीखेंगे कि वीडियो के लिए कैप्शन कैसे बनाते हैं।"
for lang in en hi; do
    ffmpeg -v error -y -f lavfi -i color=c=gray:s=640x360:r=25 -i "$tmp/$lang.wav" \
        -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac "$tmp/$lang.mp4"
done
python3 scripts/ci_smoke.py --base "http://localhost:$port" \
    --english "$tmp/en.mp4" --hindi "$tmp/hi.mp4" --expect caption --out "$tmp/smoke.json"
python3 - "$tmp/smoke.json" "$out" "$arch" "$backend_s" "$frontend_s" <<'EOF'
import json, sys
smoke, out, arch, backend, frontend = sys.argv[1:]
times = json.load(open(smoke))
times.update(arch=arch, build_s={"backend": int(backend), "frontend": int(frontend)})
json.dump(times, open(out, "w"), indent=1)
print(json.dumps(times, indent=1))
EOF
