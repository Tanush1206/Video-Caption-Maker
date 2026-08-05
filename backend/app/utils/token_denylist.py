"""
Revocation list for refresh tokens.

JWTs are self-validating, so "log out" would otherwise mean nothing: the token
stays valid until it expires, and anyone holding a copy keeps access. Recording
revoked token IDs gives logout real teeth.

Only refresh tokens are tracked. Access tokens are short-lived by design, and
checking Redis on every authenticated request would undo the main benefit of
stateless access tokens.
"""

import logging
import time
from typing import Any

from app.utils.rate_limit import get_redis

logger = logging.getLogger(__name__)


def _key(jti: str) -> str:
    return f"denylist:refresh:{jti}"


async def revoke_token(payload: dict[str, Any]) -> None:
    """
    Deny future use of this token, expiring the entry when the token would
    have expired anyway — so the list can't grow without bound.
    """
    jti = payload.get("jti")
    if not jti:
        return

    ttl = int(payload.get("exp", 0)) - int(time.time())
    if ttl <= 0:
        return  # already expired; nothing to revoke

    try:
        await get_redis().setex(_key(jti), ttl, "1")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not revoke token %s: %s", jti, exc)


async def is_revoked(payload: dict[str, Any]) -> bool:
    """
    Fails **closed**: if Redis is unreachable we treat the token as revoked.

    The opposite of the rate limiter's choice, and deliberately so — the cost
    here is re-authenticating, whereas failing open would let revoked tokens
    work again during an outage.
    """
    jti = payload.get("jti")
    if not jti:
        return True

    try:
        return await get_redis().exists(_key(jti)) == 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("Denylist unavailable, rejecting token: %s", exc)
        return True
