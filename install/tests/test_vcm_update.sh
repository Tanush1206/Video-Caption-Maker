#!/usr/bin/env bash
# `vcm update` against a fake docker and a local "release" (v1.4.0): it
# hands over to the version it downloaded; if that one can't start or stops
# before doing anything, the running version finishes the update; a bad
# checksum or a download that fails mid-update leaves the install exactly
# as it was; an ARM install still on Intel/AMD images is told it downloads
# them in full once.
#
#   bash install/tests/test_vcm_update.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
# python3, or python where python3 is only a stub (Windows); Windows Python
# reads Windows paths (cygpath, in Git Bash).
for py in python3 python; do "$py" -c pass >/dev/null 2>&1 && break; done
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
port="$("$py" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
mkdir -p "$work/release/api" "$work/bin"
echo ok > "$work/release/api/health"   # what wait_ready asks for
"$py" -m http.server "$port" --bind 127.0.0.1 --directory "$(native "$work/release")" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null; rm -rf "$work"' EXIT
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break; sleep 0.1; done

# The fake: `docker compose ... pull` fails with no network when
# FAKE_PULL_FAIL=1; `version` and `image inspect` answer FAKE_ARCH and
# FAKE_IMAGE_ARCH; every compose call is recorded.
cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
    info) exit 0 ;;
    version) echo "${FAKE_ARCH:-amd64}"; exit 0 ;;
    inspect) echo "sha256:installed"; exit 0 ;;
    image) [ "$2" = inspect ] && echo "${FAKE_IMAGE_ARCH:-amd64}"; exit 0 ;;
    compose)
        echo "$*" >> "$FAKE_CALLS"
        if [ "${*: -1}" = pull ] && [ "${FAKE_PULL_FAIL:-0}" = 1 ]; then
            echo 'Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host' >&2
            exit 1
        fi
        exit 0 ;;
esac
exit 0
EOF
chmod +x "$work/bin/docker"

# The release's vcm: the one under test with a line that says it ran, one
# that can't start, or one that stops before doing anything (exit 3).
new_vcm() {
    case "$1" in
        good) sed 's/^finish_update() {$/finish_update() {\n    echo "finished by the new vcm"/' "$here/../vcm" ;;
        broken) printf '#!/usr/bin/env bash\nif then fi\n' ;;
        early) printf '#!/usr/bin/env bash\ncase "$1" in __handover) echo vcm-handover-1 ;; *) exit 3 ;; esac\n' ;;
    esac > "$work/release/vcm"
}

failures=0
run() { # kind [bad-sums] -> status, out, calls
    rm -rf "${work:?}/home"; mkdir -p "$work/home"
    cp "$here/../vcm" "$work/home/vcm"
    echo old-prod > "$work/home/docker-compose.prod.yml"
    echo old-gpu > "$work/home/docker-compose.gpu.yml"
    printf 'VCM_VARIANT=cpu\nVCM_PORT=%s\n' "$port" > "$work/home/.env"
    echo new-prod > "$work/release/docker-compose.prod.yml"
    echo new-gpu > "$work/release/docker-compose.gpu.yml"
    new_vcm "$1"
    (cd "$work/release" && sha256sum docker-compose.prod.yml docker-compose.gpu.yml vcm > SHA256SUMS)
    if [ "${2:-}" = bad-sums ]; then sed -i '1s/^./0/' "$work/release/SHA256SUMS"; sed -i '1s/^0/f/' "$work/release/SHA256SUMS"; fi
    export FAKE_CALLS="$work/calls" VCM_BASE_URL="http://127.0.0.1:$port" VCM_PULL_WAIT=0
    : > "$FAKE_CALLS"
    set +e
    out="$(PATH="$work/bin:$PATH" bash "$work/home/vcm" update 2>&1)"; status=$?
    set -e
    calls="$(cat "$FAKE_CALLS")"
}
check() { if [ "$2" = yes ]; then echo "PASS $1"; else echo "FAIL $1"; echo "$out" | sed 's/^/    /'; failures=$((failures + 1)); fi; }
unchanged() { [ "$(cat "$work/home/docker-compose.prod.yml")" = old-prod ] && cmp -s "$work/home/vcm" "$here/../vcm" \
    && ! ls "$work/home"/*.tmp >/dev/null 2>&1 && ! grep -q " up " <<< "$calls"; }
updated() { [ "$(cat "$work/home/docker-compose.prod.yml")" = new-prod ] && cmp -s "$work/home/vcm" "$work/release/vcm" \
    && ! ls "$work/home"/*.tmp >/dev/null 2>&1 && grep -q " up " <<< "$calls"; }

run good
check "the new version finishes the update" "$( [ "$status" -eq 0 ] && grep -q "finished by the new vcm" <<< "$out" && echo yes)"
check "it pulls with the staged files, then puts them in place" "$(grep -q "docker-compose.prod.yml.tmp.* pull" <<< "$calls" && updated && echo yes)"

run good bad-sums
check "a bad checksum changes nothing" "$( [ "$status" -ne 0 ] && grep -q "didn't match" <<< "$out" && unchanged && ! grep -q pull <<< "$calls" && echo yes)"

run broken
check "a new version that can't start: this one finishes" "$( [ "$status" -eq 0 ] && grep -q "Updated." <<< "$out" && updated && echo yes)"

run early
check "a new version that stops before doing anything: this one finishes" "$( [ "$status" -eq 0 ] && grep -q "this one will" <<< "$out" && updated && echo yes)"

FAKE_PULL_FAIL=1 run good
check "no network mid-update leaves the install exactly as it was" "$( [ "$status" -ne 0 ] && grep -q "before changing anything" <<< "$out" && unchanged && echo yes)"
unset FAKE_PULL_FAIL

FAKE_ARCH=arm64 FAKE_IMAGE_ARCH=amd64 run good
check "an ARM install on Intel/AMD images is told it downloads them in full once" "$(grep -q "native ARM images" <<< "$out" && echo yes)"
FAKE_ARCH=arm64 FAKE_IMAGE_ARCH=arm64 run good
check "already native: nothing said" "$(grep -q "native ARM images" <<< "$out" || echo yes)"

[ $failures -eq 0 ] && echo "ALL PASSED" || { echo "$failures FAILED"; exit 1; }
