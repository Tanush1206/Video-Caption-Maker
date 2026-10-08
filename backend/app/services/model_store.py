"""
Fetching model weights, with progress someone can watch.

On a fresh install the first video waits for gigabytes of weights: Whisper
large-v3 is 3GB, the translator another 1.2GB. Left to the libraries, that is
minutes of a progress bar stuck at 0% that looks exactly like a hang. So the
download is done here first, ahead of the load, and its progress is reported
the same way transcription progress is.

Progress is measured from the bytes on disk rather than from the download
library's callbacks, which change shape between huggingface_hub versions and
transfer backends. The cache directory only ever means one thing.
"""

import fnmatch
import logging
import threading
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0

Progress = Callable[[int, int], None]


class ModelDownloadError(RuntimeError):
    """A model could not be fetched. The message is safe to show the user."""


CERTIFICATE_HELP = (
    "Couldn't download the model: a security program or proxy on this network is "
    "intercepting HTTPS. Put its root certificate (.crt) in the certs folder of the "
    "install and run 'vcm restart' (see Troubleshooting in the README)."
)


def _is_certificate_error(exc: BaseException) -> bool:
    """True if anywhere in the chain is a TLS verification failure."""
    seen = 0
    while exc is not None and seen < 10:
        if "certificate_verify_failed" in str(exc).lower() or "certificate verify failed" in str(exc).lower():
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


def _cache_root() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def _repo_dir(repo_id: str) -> Path:
    return _cache_root() / f"models--{repo_id.replace('/', '--')}"


def _bytes_on_disk(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for file in path.rglob("*"):
        try:
            if file.is_file() and not file.is_symlink():
                total += file.stat().st_size
        except OSError:
            continue
    return total


def cached_path(repo_id: str, revision: str | None, allow_patterns: list[str]) -> str | None:
    """The local snapshot if every wanted file is already here, else None."""
    from huggingface_hub import snapshot_download

    try:
        return snapshot_download(
            repo_id, revision=revision, allow_patterns=allow_patterns, local_files_only=True
        )
    except Exception:  # noqa: BLE001 — "not cached" comes in several exception types
        return None


def ensure(
    repo_id: str,
    *,
    revision: str | None = None,
    allow_patterns: list[str],
    on_progress: Progress | None = None,
) -> str:
    """
    Return a local path to the model, downloading it first if needed.

    `on_progress(done_bytes, total_bytes)` is called about once a second
    while downloading; total is 0 if the size could not be learned.
    """
    local = cached_path(repo_id, revision, allow_patterns)
    if local:
        return local

    from huggingface_hub import HfApi, snapshot_download

    total = 0
    try:
        info = HfApi().model_info(repo_id, revision=revision, files_metadata=True)
        total = sum(
            sibling.size or 0
            for sibling in info.siblings or []
            if any(fnmatch.fnmatch(sibling.rfilename, p) for p in allow_patterns)
        )
    except Exception as exc:  # noqa: BLE001
        if _is_certificate_error(exc):
            raise ModelDownloadError(CERTIFICATE_HELP) from exc
        raise ModelDownloadError(
            "Couldn't reach Hugging Face to download the model. Check the internet "
            "connection — models are downloaded once, on first use."
        ) from exc

    logger.info("Downloading %s (%.1f GB)", repo_id, total / 1024**3)
    repo_dir = _repo_dir(repo_id)
    baseline = _bytes_on_disk(repo_dir)
    done = threading.Event()
    result: dict[str, object] = {}

    def run() -> None:
        try:
            result["path"] = snapshot_download(
                repo_id, revision=revision, allow_patterns=allow_patterns
            )
        except BaseException as exc:  # noqa: BLE001 — re-raised on the caller's thread
            result["error"] = exc
        finally:
            done.set()

    thread = threading.Thread(target=run, name=f"download-{repo_id}", daemon=True)
    thread.start()
    while not done.wait(POLL_SECONDS):
        if on_progress:
            on_progress(max(0, _bytes_on_disk(repo_dir) - baseline), total)

    error = result.get("error")
    if error is not None:
        message = str(error).lower()
        if _is_certificate_error(error):  # type: ignore[arg-type]
            raise ModelDownloadError(CERTIFICATE_HELP) from error  # type: ignore[misc]
        if "no space" in message or "errno 28" in message:
            raise ModelDownloadError(
                "The disk is full, so the model couldn't be downloaded. Free some space "
                "and try again."
            ) from error  # type: ignore[misc]
        raise ModelDownloadError(
            "The model download failed part-way. Check the internet connection and "
            "try again — it resumes where it stopped."
        ) from error  # type: ignore[misc]

    if on_progress:
        on_progress(total, total)
    return str(result["path"])
