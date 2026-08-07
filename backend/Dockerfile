# NOTE: For Milestone 4 (GPU transcription), we'll switch the base image to
# nvidia/cuda:12.x-cudnn-runtime-ubuntu22.04 so faster-whisper can use CUDA/cuDNN.
# python:3.11-slim is fine for Milestones 1-3 (no GPU workload yet).
FROM python:3.11-slim

# FFmpeg is required for mp4 -> mp3 extraction (Milestone 4)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Optional extra CA certificates, for machines where antivirus or a corporate
# proxy inspects TLS and re-signs it with a private root the container doesn't
# trust (pip then fails with CERTIFICATE_VERIFY_FAILED). The bracket glob makes
# this a no-op when backend/certs/ is absent, which is the normal case —
# the directory is gitignored because such certs are machine-specific.
COPY cert[s]/ /usr/local/share/ca-certificates/
RUN update-ca-certificates

# pip ships its own certifi bundle and ignores the system store, so point it
# at the system bundle explicitly.
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Install dependencies first for better layer caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[dev]"

# CTranslate2 loads libcublas/libcudnn by soname at runtime and does not look
# inside pip's nvidia/* package directories on its own.
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib

# Fonts for burning captions in (Milestone 7/8). Liberation is metric-compatible
# with Arial, Times New Roman and Courier New, which is what makes the browser
# preview trustworthy: the editor previews in Arial, libass renders in Liberation
# Sans, and because the glyph advance widths are identical the line breaks land
# in the same places. A visually-similar-but-different font would not do that.
#
# Deliberately placed after the pip install rather than beside the other apt
# packages: adding a font must not invalidate the layer that builds torch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
