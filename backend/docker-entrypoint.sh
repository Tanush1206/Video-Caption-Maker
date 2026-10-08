#!/bin/sh
# One image, two roles.
#
#   api     migrate the database, then serve the API (no --reload)
#   worker  run the Celery worker that transcribes, translates and renders
#
# Anything else is executed as given, e.g. `docker compose run backend sh`.
set -e

# Optional extra CA certificates, for networks where antivirus or a corporate
# proxy re-signs TLS (model downloads then fail with CERTIFICATE_VERIFY_FAILED).
# Drop *.crt files into the install's certs/ folder; they are mounted here and
# trusted at start. Nothing is baked into the image.
EXTRA_CA=/usr/local/share/ca-certificates/extra
if ls "$EXTRA_CA"/*.crt >/dev/null 2>&1; then
    # Rebuilds /etc/ssl/certs/ca-certificates.crt, which SSL_CERT_FILE and
    # REQUESTS_CA_BUNDLE point every client at (see the Dockerfile).
    update-ca-certificates >/dev/null 2>&1 || true
    echo "Trusting extra CA certificates from $EXTRA_CA"
fi

case "$1" in
    api)
        alembic upgrade head
        exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers \
            --forwarded-allow-ips='*' --timeout-keep-alive 75
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
