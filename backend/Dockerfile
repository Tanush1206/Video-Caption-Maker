# NOTE: For Milestone 4 (GPU transcription), we'll switch the base image to
# nvidia/cuda:12.x-cudnn-runtime-ubuntu22.04 so faster-whisper can use CUDA/cuDNN.
# python:3.11-slim is fine for Milestones 1-3 (no GPU workload yet).
FROM python:3.11-slim

# FFmpeg is required for mp4 -> mp3 extraction (Milestone 4)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[dev]"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
