#!/usr/bin/env bash
# `vcm pull` (and so `vcm update` and the installer) against a fake docker
# (v1.3.1). Antivirus that scans HTTPS (Quick Heal, measured) breaks a few
# of Docker's TLS handshakes to GitHub's registry: the pull is tried again,
# and if it keeps failing the message says what to change.
#
#   bash install/tests/test_vcm_pull.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/bin"
cp "$here/../vcm" "$work/home/vcm"
touch "$work/home/docker-compose.prod.yml"
printf 'VCM_VARIANT=cpu\n' > "$work/home/.env"

# The fake: `docker info` works; `docker compose ... pull` fails while the
# counter in $FAKE_FAILS is above 0, saying $FAKE_SAYS; anything else works.
cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
[ "$1" = info ] && exit 0
if [ "${*: -1}" = pull ]; then
    echo "pull" >> "$FAKE_CALLS"
    left="$(cat "$FAKE_FAILS")"
    if [ "$left" -gt 0 ]; then
        echo $((left - 1)) > "$FAKE_FAILS"
        echo "$FAKE_SAYS" >&2
        exit 1
    fi
fi
exit 0
EOF
chmod +x "$work/bin/docker"

TLS='failed to copy: httpReadSeeker: failed open: failed to do request: Get "https://pkg-containers.githubusercontent.com/ghcrblobs15/blobs/sha256:435c": remote error: tls: error decoding message'
failures=0
run() { # fails, says -> sets status, out, calls
    export FAKE_FAILS="$work/fails" FAKE_CALLS="$work/calls" FAKE_SAYS="$2" VCM_PULL_WAIT=0
    echo "$1" > "$FAKE_FAILS"; : > "$FAKE_CALLS"
    set +e
    out="$(PATH="$work/bin:$PATH" bash "$work/home/vcm" pull 2>&1)"; status=$?
    set -e
    calls="$(wc -l < "$FAKE_CALLS" | tr -d ' ')"
}
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; echo "$out" | sed 's/^/    /'; failures=$((failures + 1)); fi; }

run 1 "$TLS"
check "a TLS failure is tried again and the pull succeeds" '[ $status -eq 0 ] && [ "$calls" = 2 ]'
check "it says it is trying again" 'grep -q "trying again" <<< "$out"'

run 9 "$TLS"
check "it gives up after three tries" '[ $status -ne 0 ] && [ "$calls" = 3 ]'
check "it names HTTPS scanning by antivirus" 'grep -qi "antivirus" <<< "$out" && grep -qi "HTTPS" <<< "$out"'
check "it names both hosts to allow" 'grep -q "ghcr.io" <<< "$out" && grep -q "pkg-containers.githubusercontent.com" <<< "$out"'

run 9 "no matching manifest for linux/arm64/v8 in the manifest list entries"
check "a non-network failure is not tried again" '[ $status -ne 0 ] && [ "$calls" = 1 ]'
check "and says nothing about antivirus" '! grep -qi "antivirus" <<< "$out"'

[ $failures -eq 0 ] && echo "ALL PASSED" || { echo "$failures FAILED"; exit 1; }
