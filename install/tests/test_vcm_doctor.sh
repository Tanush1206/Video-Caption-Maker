#!/usr/bin/env bash
# `vcm doctor` against a fake docker and a fake app (v1.4.0): the report has
# what a bug report needs and none of the secrets the install holds.
#
#   bash install/tests/test_vcm_doctor.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
for py in python3 python; do "$py" -c pass >/dev/null 2>&1 && break; done
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
port="$("$py" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
mkdir -p "$work/app/api" "$work/bin" "$work/home" "$work/cwd" "$work/fakehome/me"
echo '{"status":"ok"}' > "$work/app/api/health"
echo '{"version":"1.4.0","gemini_configured":true,"vocabulary": ["Ketan Sharma","Akrapovic"],"vocabulary_max":100}' > "$work/app/api/system"
"$py" -m http.server "$port" --bind 127.0.0.1 --directory "$(native "$work/app")" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$work"' EXIT
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break; sleep 0.1; done

cp "$here/../vcm" "$work/home/vcm"
touch "$work/home/docker-compose.prod.yml"
cat > "$work/home/.env" <<EOF
POSTGRES_PASSWORD=pg-supersecret-123
JWT_SECRET_KEY=jwt-supersecret-456
GEMINI_API_KEY=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY1234567
VCM_VERSION=latest
VCM_VARIANT=cpu
VCM_PORT=$port
EOF

# The fake docker: logs that hold every kind of secret the report must drop.
cat > "$work/bin/docker" <<EOF
#!/usr/bin/env bash
case "\$1" in
    version) echo "docker 29.9.2 on linux/amd64" ;;
    info) echo "CPUs 8, memory 16000000000 bytes, Docker Desktop" ;;
    inspect)
        case "\$*" in
            *image.version*) echo "1.3.9" ;;
            *) echo "/vcm-backend-1 ghcr.io/tanush1206/video-caption-maker-backend:latest-cpu sha256:abc" ;;
        esac ;;
    compose)
        case "\$*" in
            *" version"*) echo "Docker Compose version v5.6.1" ;;
            *" ps -aq"*) echo "c1" ;;
            *" ps -a"*) echo "vcm-backend-1  running (healthy)" ;;
            *" logs"*)
                echo 'backend-1 | GET /api/exports/7/download?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl HTTP/1.1 200'
                echo 'backend-1 | Authorization: Bearer abc.def.ghi'
                echo 'worker-1  | Video 12 uploaded by someone@example.com: "My Holiday In Goa.mp4"'
                echo 'worker-1  | wrote /app/storage/exports/family_wedding.mp4 from $work/fakehome/me/Videos'
                echo 'worker-1  | Gemini key AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY1234567 rejected'
                echo 'worker-1  | password=hunter2 in a URL'
                echo 'worker-1  | GPU 0: NVIDIA RTX (UUID: GPU-1234-fingerprint)'
                echo 'worker-1  | burned TRIP.MOV, then clip.mp4.' ;;
        esac ;;
esac
exit 0
EOF
chmod +x "$work/bin/docker"

set +e
out="$(cd "$work/cwd" && HOME="$work/fakehome/me" PATH="$work/bin:$PATH" bash "$work/home/vcm" doctor 2>&1)"; status=$?
set -e
report="$(ls "$work/cwd"/vcm-doctor-*.txt 2>/dev/null | head -1 || true)"
text="$(cat "$report" 2>/dev/null || true)"

failures=0
check() { if [ "$2" = yes ]; then echo "PASS $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi; }
has() { if grep -qF -- "$1" <<< "$text"; then echo yes; else echo no; fi; }
lacks() { if grep -qF -- "$1" <<< "$text"; then echo no; else echo yes; fi; }

check "it writes a report in the current folder" "$( [ "$status" -eq 0 ] && [ -n "$report" ] && echo yes)"
check "it says to review it before attaching" "$(grep -q "Review it before attaching" <<< "$out" && echo yes)"
check "the version, variant and port" "$( [ "$(has "VCM_VERSION=latest")" = yes ] && [ "$(has "VCM_VARIANT=cpu")" = yes ] && echo yes)"
# v1.4.1: the version that is running, not the "latest" an install's .env holds.
check "the second line is the running version, from the app" "$( [ "$(sed -n 2p <<< "$text")" = "Version: 1.4.0 (VCM_VERSION=latest in .env)" ] && echo yes)"
check "docker, compose, containers, health, system, logs" "$( [ "$(has "Docker Compose version v5.6.1")" = yes ] && [ "$(has "vcm-backend-1  running")" = yes ] && [ "$(has '"status":"ok"')" = yes ] && [ "$(has '"gemini_configured":true')" = yes ] && [ "$(has "worker-1")" = yes ] && echo yes)"
check "no database password or JWT secret from .env" "$( [ "$(lacks pg-supersecret)" = yes ] && [ "$(lacks jwt-supersecret)" = yes ] && echo yes)"
check "no Gemini key" "$(lacks "AIzaSyDUMMY")"
check "no download token or bearer" "$( [ "$(lacks "eyJhbGci")" = yes ] && [ "$(lacks "abc.def.ghi")" = yes ] && echo yes)"
check "no password in a URL" "$(lacks "hunter2")"
check "no email address" "$(lacks "someone@example.com")"
check "no video file names" "$( [ "$(lacks "My Holiday")" = yes ] && [ "$(lacks "family_wedding")" = yes ] && echo yes)"
check "no vocabulary words" "$( [ "$(lacks "Ketan Sharma")" = yes ] && [ "$(lacks "Akrapovic")" = yes ] && echo yes)"
check "no home folder" "$(lacks "$work/fakehome/me")"
check "no GPU serial" "$(lacks "GPU-1234-fingerprint")"
check "no file names in any case, sentence end kept" "$( [ "$(lacks "TRIP.MOV")" = yes ] && [ "$(has "burned <video>, then <video>.")" = yes ] && echo yes)"

# The app not answering: the version comes from the backend image's label.
sed "s/^VCM_PORT=.*/VCM_PORT=1/" "$work/home/.env" > "$work/home/.env.new" && mv "$work/home/.env.new" "$work/home/.env"
mkdir "$work/cwd2"
(cd "$work/cwd2" && HOME="$work/fakehome/me" PATH="$work/bin:$PATH" bash "$work/home/vcm" doctor >/dev/null 2>&1) || true
down="$(sed -n 2p "$work/cwd2"/vcm-doctor-*.txt 2>/dev/null || true)"
check "with the app down, it is the image's version, and says so" "$( [ "$down" = "Version: 1.3.9, from the image: the app isn't answering (VCM_VERSION=latest in .env)" ] && echo yes)"

[ $failures -eq 0 ] && echo "ALL PASSED" || { echo "$failures FAILED"; echo "$text" | sed 's/^/    /'; exit 1; }
