"""
Fixed-window rate limiting backed by Redis.

Redis rather than in-process counters because the API can run as multiple
workers/containers — a per-process dict would let an attacker get N times the
allowance by spreading requests across workers.
"""

import logging

from redis.asyncio import Redis

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_redis: Redis | None = None


def get_redis() -> Redis:
    """Lazily created shared client. redis-py handles pooling internally."""
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded; retry in {retry_after}s")


async def enforce_rate_limit(bucket: str, limit: int, window_seconds: int) -> None:
    """
    Count one hit against `bucket`, raising RateLimitExceeded past `limit`.

    Fails **open**: if Redis is unreachable we log and allow the request.
    Failing closed would turn a Redis blip into a total login outage, which is
    a worse and more likely problem than the brute-force window it protects.
    """
    key = f"ratelimit:{bucket}"

    try:
        redis = get_redis()
        # Pipelined so the counter and its TTL are set together — otherwise a
        # crash between the two leaves a key that never expires.
        async with redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, window_seconds, nx=True)
            count, _ = await pipe.execute()
    except Exception as exc:  # noqa: BLE001 - deliberately broad; see docstring
        logger.warning("Rate limiting unavailable, allowing request: %s", exc)
        return

    if count > limit:
        try:
            retry_after = max(await get_redis().ttl(key), 1)
        except Exception:  # noqa: BLE001
            retry_after = window_seconds
        raise RateLimitExceeded(retry_after)


async def reset_rate_limit(bucket: str) -> None:
    """Clear a bucket — called after a successful login so one good password
    doesn't leave the user throttled by their earlier typos."""
    try:
        await get_redis().delete(f"ratelimit:{bucket}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not reset rate limit bucket %s: %s", bucket, exc)
