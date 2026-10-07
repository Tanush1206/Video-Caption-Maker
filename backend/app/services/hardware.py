"""
What this machine can run, and which models that implies.

The app ships to machines nobody here has seen: a gaming PC with a 16GB card,
a laptop with 8GB of RAM and no GPU at all. Hardcoding `cuda`/`float16`/
`large-v3` made the first work and the second refuse to start. So the worker
looks at what it actually has, once, and picks from three tiers:

    GPU, >= 6GB VRAM        large-v3          float16
    CPU, >= 12GB RAM        large-v3-turbo    int8
    anything smaller        small             int8

An explicit choice always wins over the tier: the user's pick in Settings
first, then `WHISPER_MODEL_SIZE` / `WHISPER_DEVICE` / `WHISPER_COMPUTE_TYPE`.

Only the worker can answer these questions — it is the container the GPU is
passed through to. The API asks the worker's last report rather than probing
its own (GPU-less) container and getting the wrong answer.
"""

import logging
import os
import subprocess
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

AUTO = "auto"

# The tier boundaries. VRAM: large-v3 in float16 peaks a little over 4GB while
# decoding, so 6GB leaves room for the desktop that is also using the card.
# RAM: large-v3-turbo int8 plus the 1.2B translator plus the OS fits in 12GB;
# below that both drop a size.
MIN_VRAM_GB_FOR_LARGE = 6.0
MIN_RAM_GB_FOR_LARGE = 12.0

# Offered in Settings. A curated list rather than all of faster-whisper's:
# the `.en` and distil variants cannot transcribe the non-English languages
# this app exists to caption.
WHISPER_CHOICES: dict[str, str] = {
    "small": "Small · fastest, ~500 MB",
    "medium": "Medium · ~1.5 GB",
    "large-v3-turbo": "Large v3 Turbo · fast and accurate, ~1.6 GB",
    "large-v3": "Large v3 · most accurate, ~3 GB",
}

# Download sizes, for telling someone what the first run will fetch.
WHISPER_SIZES_MB = {"small": 484, "medium": 1530, "large-v3-turbo": 1620, "large-v3": 3090}


@dataclass(frozen=True)
class Hardware:
    cuda: bool
    gpu_name: str | None
    vram_gb: float | None
    ram_gb: float
    cpu_count: int

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class WhisperProfile:
    model: str
    device: str
    compute_type: str
    # "user", "env" or "auto" — shown in Settings so a surprising choice can
    # be traced to where it came from.
    source: str


@dataclass(frozen=True)
class TranslatorProfile:
    model: str
    device: str
    compute_type: str


def _ram_gb() -> float:
    """
    Memory this process may actually use.

    The smaller of the machine's total and the container's cgroup limit:
    Docker Desktop's VM, or a `mem_limit`, can be far below what the host has,
    and sizing a model to the host would OOM inside the container.
    """
    total = 0.0
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                total = int(line.split()[1]) / 1024 / 1024
                break
    except OSError:
        pass
    if not total:
        try:
            total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
        except (ValueError, OSError, AttributeError):
            total = 0.0

    for limit_file in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            raw = Path(limit_file).read_text().strip()
        except OSError:
            continue
        if raw.isdigit():
            limit = int(raw) / 1024**3
            # cgroup v1 reports "no limit" as a huge number.
            if 0 < limit < total or not total:
                total = limit
        break

    return round(total, 1)


def _cuda_device_count() -> int:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count()
    except Exception:  # noqa: BLE001 — no CUDA runtime is an answer, not an error
        return 0


def _gpu_info() -> tuple[str | None, float | None]:
    """Name and VRAM of the first GPU, from nvidia-smi when the runtime mounts it."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout.strip().splitlines()
    except (OSError, subprocess.SubprocessError):
        return None, None
    if not out:
        return None, None
    name, _, mib = out[0].partition(",")
    try:
        return name.strip(), round(float(mib) / 1024, 1)
    except ValueError:
        return name.strip() or None, None


@lru_cache
def detect() -> Hardware:
    cuda = _cuda_device_count() > 0
    gpu_name, vram_gb = _gpu_info() if cuda else (None, None)
    hardware = Hardware(
        cuda=cuda,
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        ram_gb=_ram_gb(),
        cpu_count=os.cpu_count() or 1,
    )
    logger.info("Detected hardware: %s", hardware)
    return hardware


def _auto_model(hw: Hardware) -> str:
    if hw.cuda:
        # Unknown VRAM (no nvidia-smi) is trusted: CUDA itself works, and a
        # card too small for large-v3 fails loudly rather than silently.
        if hw.vram_gb is None or hw.vram_gb >= MIN_VRAM_GB_FOR_LARGE:
            return "large-v3"
        return "small"
    return "large-v3-turbo" if hw.ram_gb >= MIN_RAM_GB_FOR_LARGE else "small"


def whisper_profile(hw: Hardware, user_model: str | None = None) -> WhisperProfile:
    settings = get_settings()

    if user_model and user_model != AUTO:
        model, source = user_model, "user"
    elif settings.whisper_model_size and settings.whisper_model_size != AUTO:
        model, source = settings.whisper_model_size, "env"
    else:
        model, source = _auto_model(hw), "auto"

    device = settings.whisper_device if settings.whisper_device != AUTO else None
    if device is None or (device == "cuda" and not hw.cuda):
        device = "cuda" if hw.cuda else "cpu"

    compute = settings.whisper_compute_type
    # float16 has no CPU kernel in CTranslate2; an env file written for a GPU
    # machine must not stop a CPU one from working.
    if compute == AUTO or (device == "cpu" and "float16" in compute):
        if device == "cuda":
            compute = "float16" if model.startswith("large") or model == "medium" else "int8_float16"
        else:
            compute = "int8"

    return WhisperProfile(model=model, device=device, compute_type=compute, source=source)


def translator_profile(hw: Hardware) -> TranslatorProfile:
    settings = get_settings()
    model = settings.translation_model
    if model == AUTO:
        model = "m2m100_1.2B" if hw.ram_gb >= MIN_RAM_GB_FOR_LARGE else "m2m100_418M"
    if hw.cuda:
        return TranslatorProfile(model=model, device="cuda", compute_type="int8_float16")
    return TranslatorProfile(model=model, device="cpu", compute_type="int8")
