"""
Who may talk to a local install's API, and a record of what they changed.

A local install has no login: the person at the computer is the only user,
and the API listens on 127.0.0.1. That is not, on its own, a boundary. A web
page the user has open elsewhere can reach localhost too:

- DNS rebinding: a domain that resolves to 127.0.0.1 makes its page
  same-origin with the install, so CORS never applies and it can read and
  delete everything. The Host it sends is its own name, not localhost.
- Cross-site and same-site requests: a page on any other origin, including
  another app on a different localhost port, can send requests the browser
  labels as such in Sec-Fetch-Site.

So in local mode every request must be addressed to a local name, and a
request that changes something must come from the app itself (or from a
script, which sends no browser headers at all).

Separately, every deletion, settings change and refused request is appended
to storage/audit.log, on the media volume, so it survives updates. Six videos
were once deleted through a running install by something nobody could
identify afterwards: the access log had no User-Agent or Origin, and the
container holding it had since been replaced.
"""

import json
import logging
import time
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger(__name__)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "backend"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
AUDIT_FILE = "audit.log"
AUDIT_MAX_BYTES = 5 * 1024 * 1024

REFUSED = (
    "This request didn't come from VideoCaptionMaker on this computer, so it was refused."
)


def _hostname(value: str | None) -> str | None:
    """'localhost:3001' -> 'localhost'; '[::1]:3001' -> '::1'; '' -> None."""
    if not value:
        return None
    try:
        return urlsplit(f"//{value.strip()}").hostname
    except ValueError:
        return ""


def refusal_reason(request: Request) -> str | None:
    """Why this request is refused, or None if it may proceed."""
    headers = request.headers
    # Behind the Next proxy, Host is always backend:8000 and the browser's own
    # Host arrives as X-Forwarded-Host. Called directly (dev, healthchecks,
    # scripts), Host is the real one.
    forwarded = (headers.get("x-forwarded-host") or "").strip().lower()
    host = _hostname(forwarded or headers.get("host"))
    if host is not None and host not in LOCAL_HOSTS:
        return f"host {host!r} is not this computer"

    if request.method in SAFE_METHODS:
        return None

    if (headers.get("sec-fetch-site") or "").lower() == "cross-site":
        return "cross-site request"

    # A browser sends Origin on every state-changing request; a script sends
    # none and is let through (it could send any header it liked anyway).
    origin = headers.get("origin")
    if origin is None:
        return None
    if forwarded:
        # Through the app's own proxy, the page that sent this was served by
        # this install, so its origin is exactly the address in the browser:
        # host and port, whichever port the install was given, localhost or
        # 127.0.0.1. Another app on this machine has another port.
        if urlsplit(origin.lower()).netloc != forwarded:
            return f"origin {origin!r} is not this app ({forwarded})"
        return None
    # Straight to the backend, which only the dev setup exposes: its frontend
    # is another origin, listed in CORS_ORIGINS.
    if origin not in get_settings().cors_origins_list:
        return f"origin {origin!r} is not an allowed frontend"
    return None


def _audited(request: Request, status: int) -> bool:
    if status == 403:
        return True
    if request.method == "DELETE":
        return True
    return request.method in {"PATCH", "PUT", "POST"} and request.url.path.startswith(
        "/api/system/settings"
    )


def audit(request: Request, status: int, reason: str | None = None) -> None:
    """Append one line to storage/audit.log. Never the body: it can hold a key."""
    headers = request.headers
    entry = {
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": request.method,
        "path": request.url.path,
        "status": status,
        "user_agent": headers.get("user-agent"),
        "origin": headers.get("origin"),
        "referer": headers.get("referer"),
        "sec_fetch_site": headers.get("sec-fetch-site"),
        "host": headers.get("x-forwarded-host") or headers.get("host"),
        "client": request.client.host if request.client else None,
    }
    if reason:
        entry["refused"] = reason
    path = Path(get_settings().storage_local_path) / AUDIT_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.stat().st_size > AUDIT_MAX_BYTES:
            path.replace(path.with_suffix(".log.1"))
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        logger.exception("Could not write the audit log")
    logger.info("audit %s", json.dumps(entry))


async def guard(request: Request, call_next):
    """HTTP middleware: refuse what local mode must not accept; audit changes."""
    if not get_settings().is_local_mode:
        return await call_next(request)

    reason = refusal_reason(request)
    if reason:
        audit(request, 403, reason)
        return JSONResponse(status_code=403, content={"detail": REFUSED})

    response = await call_next(request)
    if _audited(request, response.status_code):
        audit(request, response.status_code)
    return response
