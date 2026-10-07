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
RUN mkdir app && touch app/__init__.py \
    # torch arrives with sentence-transformers. The CPU wheel, in both
    # variants: it only embeds short captions for search, and the CUDA wheel
    # is 5 GB of libraries nothing else here uses.
    && pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        -c constraints.txt . \
    && if [ "$VARIANT" = "cuda" ]; then \
        pip install nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.24.0.43; \
    fi \
    && pip uninstall -y videocaptionmaker-backend

# ── runtime ──────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime
ARG VARIANT=cpu
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/Tanush1206/Video-Caption-Maker" \
      org.opencontainers.image.title="VideoCaptionMaker backend (${VARIANT})" \
      org.opencontainers.image.version="${VERSION}"

# FFmpeg for audio extraction and burning captions in; Liberation for the
# Arial/Times/Courier metric-compatible faces; fontconfig so libass finds the
# vendored and downloaded fonts by family name.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg fonts-liberation fontconfig ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VCM_VARIANT=${VARIANT} \
    VCM_VERSION=${VERSION} \
    # CTranslate2 loads libcublas/libcudnn by soname and does not look inside
    # pip's nvidia/* package directories on its own. Harmless in the CPU image.
    LD_LIBRARY_PATH=/opt/venv/lib/python3.11/site-packages/nvidia/cublas/lib:/opt/venv/lib/python3.11/site-packages/nvidia/cudnn/lib \
    # Model weights live on a volume (see compose); this is its mount point.
    HF_HOME=/root/.cache/huggingface \
    # Logged once per download otherwise, and there is no token to set.
    HF_HUB_DISABLE_IMPLICIT_TOKEN=1 \
    TOKENIZERS_PARALLELISM=false

COPY frontend/public/fonts/ /usr/share/fonts/truetype/vcm/
RUN fc-cache -f

WORKDIR /app
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/app ./app
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/storage

EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["api"]

# ── dev: the runtime plus test tools; source is bind-mounted over /app ───────
FROM runtime AS dev
COPY backend/pyproject.toml backend/constraints.txt /tmp/build/
RUN pip install -c /tmp/build/constraints.txt "pytest>=8.2.0" "pytest-asyncio>=0.23.0" "ruff>=0.5.0"
COPY backend/tests ./tests
COPY backend/pytest.ini ./
