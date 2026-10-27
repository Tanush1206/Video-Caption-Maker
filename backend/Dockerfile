# syntax=docker/dockerfile:1.7
#
# The API and the worker share this image; compose picks the command.
#
#   VARIANT=cpu   runs anywhere. ~2 GB.
#   VARIANT=cuda  adds the CUDA 12 cuBLAS/cuDNN that CTranslate2 loads, pinned
#                 to the versions verified on an RTX 5080 (Blackwell, sm_120).
#                 The NVIDIA driver itself comes from the host.
#
# Built from the repository root, because the caption fonts live in
# frontend/public/fonts: the browser preview and libass have to read the very
# same files, so both images carry a copy of one directory.
#
# Targets: `runtime` (what ships) and `dev` (adds the test tools; used by
# docker-compose.yml with the source bind-mounted over /app).

ARG PYTHON_IMAGE=python:3.11.15-slim-trixie

# ── deps: a virtualenv with exactly the pinned stack ─────────────────────────
FROM ${PYTHON_IMAGE} AS deps
ARG VARIANT=cpu
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /build
COPY backend/pyproject.toml backend/constraints.txt ./
# Only the package metadata is needed to resolve dependencies; an empty
# package keeps this layer from depending on the source.
# Optional build-time CA (`--secret id=extra_ca,src=proxy-root.crt`) for
# machines whose antivirus or proxy re-signs TLS. Mounted for this step only:
# it is never written to a layer, and CI builds without it.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then \
        cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem \
        && export PIP_CERT=/tmp/ca.pem; \
    fi \
    && mkdir app && touch app/__init__.py \
    # torch arrives with sentence-transformers. The CPU wheel, in both
    # variants: it only embeds short captions for search, and the CUDA wheel
    # is 5 GB of libraries nothing else here uses.
    && pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        -c constraints.txt . \
    && if [ "$VARIANT" = "cuda" ]; then \
        pip install nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.24.0.43; \
    fi \
    && pip uninstall -y videocaptionmaker-backend \
    && rm -f /tmp/ca.pem

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime
ARG VARIANT=cpu
LABEL org.opencontainers.image.source="https://github.com/Tanush1206/Video-Caption-Maker" \
      org.opencontainers.image.title="VideoCaptionMaker backend (${VARIANT})"

# FFmpeg for audio extraction and burning captions in; Liberation for the
# Arial/Times/Courier metric-compatible faces; fontconfig so libass finds the
# vendored and downloaded fonts by family name. DejaVu is offered in the style
# panel and is named explicitly: once Noto satisfies fontconfig's font
# dependency, apt stops pulling it in. Noto Core is the fallback for
# scripts the chosen caption font lacks (Devanagari, Arabic, Thai, Cyrillic…):
# without it libass draws empty boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg fonts-dejavu-core fonts-liberation fonts-noto-core fontconfig ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VCM_VARIANT=${VARIANT} \
    # CTranslate2 loads libcublas/libcudnn by soname and does not look inside
    # pip's nvidia/* package directories on its own. Harmless in the CPU image.
    LD_LIBRARY_PATH=/opt/venv/lib/python3.11/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.11/site-packages/nvidia/cudnn/lib \
    # Model weights live on a volume (see compose); this is its mount point.
    HF_HOME=/root/.cache/huggingface \
    # Logged once per download otherwise, and there is no token to set.
    HF_HUB_DISABLE_IMPLICIT_TOKEN=1 \
    # Plain HTTP downloads, not the xet backend. xet assembles a file in memory
    # and writes it at the end, so a 1.2 GB model showed "0.0 of 1.2 GB" for
    # its whole download; HTTP writes as it goes (progress the user can watch)
    # and resumes from the partial file after a dropped connection.
    HF_HUB_DISABLE_XET=1 \
    # One trust store for every client. httpx (huggingface_hub) and requests
    # ship their own certifi bundle and ignore the system one, so an extra CA
    # trusted by the entrypoint would reach urllib and nothing else. The
    # system bundle already holds the standard roots.
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    TOKENIZERS_PARALLELISM=false

# HarfBuzz, the shaper libass uses, for measuring caption lines on the same
# font files (services/caption_layout.py). Its own layer, not a line in
# pyproject.toml: that file and constraints.txt feed the deps layer above, and
# touching either rebuilds the whole virtualenv — every user would download
# 0.8 GB (CPU) or 2.3 GB (CUDA) on update for one 2 MB wheel. Fold it into
# pyproject.toml the next time the dependencies change anyway.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then \
        cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem \
        && export PIP_CERT=/tmp/ca.pem SSL_CERT_FILE=/tmp/ca.pem REQUESTS_CA_BUNDLE=/tmp/ca.pem; \
    fi \
    && PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1 pip install --no-deps uharfbuzz==0.56.3 \
    && rm -f /tmp/ca.pem

COPY frontend/public/fonts/ /usr/share/fonts/truetype/vcm/
RUN fc-cache -f

# After the large layers on purpose, so this changes none of them.
#
# The app runs as `vcm`, not root (docker-entrypoint.sh drops to it). HF_HOME
# stays under /root, where the compose files of every version mount the models
# volume, so /root only needs to be passable.
#
# The four emSign roots are distrusted: their intermediate CA keys were
# compromised (GHSA-6q48-6c7w-9gw2). They're switched off in Debian's store,
# and certifi's bundle becomes that store, so every client trusts the same
# list (and the certs/ extra CAs) without rebuilding the Python layer.
RUN useradd --system --uid 10001 --user-group --create-home --home-dir /home/vcm vcm \
    && chmod 0711 /root \
    && sed -i -E 's|^(mozilla/emSign_.*\.crt)$|!\1|' /etc/ca-certificates.conf \
    && update-ca-certificates --fresh >/dev/null \
    && ln -sf /etc/ssl/certs/ca-certificates.crt /opt/venv/lib/python3.11/site-packages/certifi/cacert.pem

# Third-party notices (THIRD_PARTY_NOTICES.md), generated from what is
# actually installed: every Python package's own licence files, Python's,
# the bundled fonts' OFL, and the GPL source offer: each Debian source package
# in this image at its exact version, with where that source is. Debian's
# per-package licence texts are already in /usr/share/doc/*/copyright.
COPY THIRD_PARTY_NOTICES.md LICENSE /licenses/
RUN set -e \
    && for info in /opt/venv/lib/python3.11/site-packages/*.dist-info /usr/local/lib/python3.11/site-packages/*.dist-info; do \
        dir="/licenses/python/$(basename "$info" .dist-info)"; \
        mkdir -p "$dir"; \
        find "$info" -type f \( -iname 'licen[cs]e*' -o -iname 'copying*' -o -iname 'notice*' -o -iname 'authors*' \) \
            -exec cp --backup=numbered -t "$dir" {} +; \
        rmdir "$dir" 2>/dev/null || true; \
    done \
    && mkdir -p /licenses/python-runtime /licenses/fonts \
    && cp /usr/local/lib/python3.11/LICENSE.txt /licenses/python-runtime/ \
    && cp /usr/share/fonts/truetype/vcm/OFL-*.txt /licenses/fonts/ \
    && { echo "Debian $(cat /etc/debian_version) packages in this image: source package, exact version, and where that source is."; \
         echo "Licence texts: /usr/share/doc/<binary package>/copyright"; \
         echo "If a link stops working, ask for the source in a GitHub issue: https://github.com/Tanush1206/Video-Caption-Maker/issues"; \
         echo; \
         dpkg-query -W -f='${source:Package}\t${source:Version}\n' | sort -u | while IFS="$(printf '\t')" read -r pkg ver; do \
             enc="$(printf '%s' "$ver" | sed -e 's/%/%25/g' -e 's/:/%3A/g' -e 's/+/%2B/g' -e 's/~/%7E/g')"; \
             printf '%s\t%s\thttps://snapshot.debian.org/package/%s/%s/\n' "$pkg" "$ver" "$pkg" "$enc"; \
         done; } > /licenses/SOURCES-debian.txt

WORKDIR /app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/storage

# The version goes last. An ARG is visible to every RUN after it, so declared
# at the top of this stage a new version number invalidated every layer below
# it: each release re-downloaded the whole image (0.8 GB CPU, 2.3 GB CUDA)
# though nothing but the app had changed. Here it is metadata only, and an
# update with unchanged dependencies fetches just the app layers.
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"
ENV VCM_VERSION=${VERSION}

EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["api"]

# ── dev: the runtime plus test tools; source is bind-mounted over /app ───────
FROM runtime AS dev
COPY backend/pyproject.toml backend/constraints.txt /tmp/build/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then \
        cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem \
        # The runtime's SSL_CERT_FILE / REQUESTS_CA_BUNDLE outrank PIP_CERT
        # here, so all three point at the combined bundle for this step.
        && export PIP_CERT=/tmp/ca.pem SSL_CERT_FILE=/tmp/ca.pem REQUESTS_CA_BUNDLE=/tmp/ca.pem; \
    fi \
    && pip install -c /tmp/build/constraints.txt "pytest>=8.2.0" "pytest-asyncio>=0.23.0" "ruff>=0.5.0" \
    && rm -f /tmp/ca.pem
COPY backend/tests ./tests
COPY backend/pytest.ini ./
