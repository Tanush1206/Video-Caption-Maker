"""
Forwarded headers, believed only from the app's own frontend.

Behind the Next proxy every request reaches the API from the `frontend`
container, so the real client address and scheme arrive in X-Forwarded-For and
X-Forwarded-Proto. Believing those from *anyone* (uvicorn's
`--forwarded-allow-ips='*'`, as this used to run) lets any caller that can
reach the API write whatever client address it likes into the audit log.

uvicorn only trusts IP addresses and networks, and the frontend has neither a
fixed IP nor a running container when the API starts (it waits for the API to
be healthy). So uvicorn's own handling is switched off (`--no-proxy-headers`
in docker-entrypoint.sh), and this middleware trusts the addresses the
configured proxy names resolve to, looked up again every few seconds.
"""

import socket
import time

from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

# Re-resolve at most this often. Long enough that an untrusted caller cannot
# make every one of its requests cost a DNS lookup; short enough that a
# recreated frontend container (new IP) is recognised within seconds.
RESOLVE_INTERVAL_SECONDS = 5.0


def resolve(name: str) -> set[str]:
    """Every address `name` resolves to; empty if it doesn't (yet)."""
    try:
        return {info[4][0] for info in socket.getaddrinfo(name, None)}
    except OSError:
        return set()


class TrustedProxyHeaders:
    """Apply X-Forwarded-For/-Proto only when the peer is a trusted proxy."""

    def __init__(self, app, proxies: list[str]) -> None:
        self.app = app
        self.proxies = [name for name in proxies if name]
        self._addresses: frozenset[str] = frozenset()
        self._inner = None
        self._resolved_at = float("-inf")

    def _refresh(self) -> None:
        now = time.monotonic()
        if now - self._resolved_at < RESOLVE_INTERVAL_SECONDS:
            return
        self._resolved_at = now
        addresses = frozenset(ip for name in self.proxies for ip in resolve(name))
        if addresses != self._addresses or self._inner is None:
            self._addresses = addresses
            self._inner = ProxyHeadersMiddleware(self.app, trusted_hosts=sorted(addresses))

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not self.proxies:
            return await self.app(scope, receive, send)

        client = scope.get("client")
        peer = client[0] if client else None
        # Throttled, and done even for a peer already trusted: a recreated
        # frontend gets a new address, and Docker may hand its old one to
        # another container.
        self._refresh()
        if peer in self._addresses:
            return await self._inner(scope, receive, send)
        return await self.app(scope, receive, send)
