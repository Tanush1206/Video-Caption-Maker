"""
X-Forwarded-For and -Proto are believed only from the frontend container.

The API used to run with uvicorn's `--forwarded-allow-ips='*'`, so any caller
could put any client address into the audit log.
"""

from pathlib import Path

import pytest

from app import proxy_headers
from app.proxy_headers import TrustedProxyHeaders

FRONTEND_IP = "172.18.0.6"
FORWARDED = [(b"x-forwarded-for", b"203.0.113.9"), (b"x-forwarded-proto", b"https")]


@pytest.fixture
def frontend_at(monkeypatch):
    """Point the `frontend` name at a settable address, and skip the resolve throttle."""
    where = {"frontend": {FRONTEND_IP}}
    monkeypatch.setattr(proxy_headers, "resolve", lambda name: set(where.get(name, set())))
    monkeypatch.setattr(proxy_headers, "RESOLVE_INTERVAL_SECONDS", 0)
    return where


async def _through(peer: str, headers=FORWARDED) -> dict:
    """What the app behind the middleware sees for one request from `peer`."""
    seen = {}

    async def app(scope, receive, send):
        seen["client"] = scope["client"]
        seen["scheme"] = scope["scheme"]

    scope = {"type": "http", "client": (peer, 51000), "scheme": "http", "headers": list(headers)}
    await TrustedProxyHeaders(app, ["frontend"])(scope, None, None)
    return seen


async def test_the_frontend_s_forwarded_client_is_believed(frontend_at):
    seen = await _through(FRONTEND_IP)
    assert seen["client"][0] == "203.0.113.9"
    assert seen["scheme"] == "https"


async def test_anyone_else_s_forwarded_headers_are_ignored(frontend_at):
    seen = await _through("172.18.0.99")
    assert seen["client"] == ("172.18.0.99", 51000)
    assert seen["scheme"] == "http"


async def test_a_recreated_frontend_with_a_new_address_is_recognised(frontend_at):
    seen = {}

    async def app(scope, receive, send):
        seen["client"] = scope["client"]

    middleware = TrustedProxyHeaders(app, ["frontend"])
    scope = lambda peer: {  # noqa: E731
        "type": "http", "client": (peer, 1), "scheme": "http", "headers": list(FORWARDED)
    }

    await middleware(scope(FRONTEND_IP), None, None)
    assert seen["client"][0] == "203.0.113.9"

    frontend_at["frontend"] = {"172.18.0.7"}
    await middleware(scope(FRONTEND_IP), None, None)
    assert seen["client"][0] == FRONTEND_IP  # the old address is no longer trusted
    await middleware(scope("172.18.0.7"), None, None)
    assert seen["client"][0] == "203.0.113.9"


async def test_an_unresolvable_frontend_trusts_nobody(frontend_at):
    frontend_at.clear()
    seen = await _through(FRONTEND_IP)
    assert seen["client"] == (FRONTEND_IP, 51000)


def test_uvicorn_no_longer_trusts_every_peer():
    entrypoint = (Path(__file__).resolve().parents[1] / "docker-entrypoint.sh").read_text()
    assert "--forwarded-allow-ips" not in entrypoint
    assert "--no-proxy-headers" in entrypoint
