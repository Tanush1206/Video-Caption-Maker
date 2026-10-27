#!/bin/sh
# One image, two roles.
#
#   api     migrate the database, then serve the API (no --reload)
#   worker  run the Celery worker that transcribes, translates and renders
#
# Anything else is executed as given, e.g. `docker compose run backend sh`.
#
# Everything runs as the unprivileged user `vcm`. The container starts as
# root only for the two things that need it, then drops to `vcm` and runs
# this script again (docs/SECURITY.md §5a).
set -e

if [ "$(id -u)" = 0 ]; then
    # Optional extra CA certificates, for networks where antivirus or a
    # corporate proxy re-signs TLS (model downloads then fail with
    # CERTIFICATE_VERIFY_FAILED). Drop *.crt files into the install's certs/
    # folder; they are mounted here and trusted at start. Nothing is baked
    # into the image.
    EXTRA_CA=/usr/local/share/ca-certificates/extra
    if ls "$EXTRA_CA"/*.crt >/dev/null 2>&1; then
        # Rebuilds /etc/ssl/certs/ca-certificates.crt, which SSL_CERT_FILE,
        # REQUESTS_CA_BUNDLE and certifi all point at (see the Dockerfile).
        update-ca-certificates >/dev/null 2>&1 || true
        echo "Trusting extra CA certificates from $EXTRA_CA"
    fi

    # The volumes the app writes to. Versions up to 1.1.0 wrote them as root,
    # and Docker creates a new volume's directory as root, so anything not
    # yet ours is handed over. Every start, not once: it finds nothing to do
    # after the first, and it mends a file a root `docker exec` left behind.
    for dir in /app/storage "${HF_HOME:-/root/.cache/huggingface}" /usr/share/fonts/truetype/vcm-cache; do
        mkdir -p "$dir"
        find "$dir" ! -user vcm -exec chown -h vcm:vcm {} +
    done

    exec env HOME=/home/vcm setpriv --reuid=vcm --regid=vcm --init-groups -- "$0" "$@"
fi

case "$1" in
    api)
        alembic upgrade head
        # --no-proxy-headers: forwarded headers are believed only from the
        # frontend container, by app/proxy_headers.py. uvicorn can trust IPs
        # but not a service name, and the frontend's IP isn't known up front.
        exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers \
            --timeout-keep-alive 75
        ;;
    worker)
        # --pool=solo: one job at a time. Whisper holds gigabytes of RAM or
        # VRAM, and two copies would exhaust either on an ordinary machine.
        exec celery -A app.workers.celery_app worker --loglevel=info --pool=solo
        ;;
    *)
        exec "$@"
        ;;
esac
