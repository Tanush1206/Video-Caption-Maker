import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.utils.rate_limit import get_redis


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
async def clear_rate_limits():
    """
    Every test shares one rate-limit bucket: ASGITransport has no client
    address, so all requests land in the "unknown" IP bucket. Without this,
    the suite would start 429-ing partway through.
    """
    redis = get_redis()
    async for key in redis.scan_iter("ratelimit:*"):
        await redis.delete(key)
    yield


@pytest.fixture
def unique_email() -> str:
    """Fresh address per test so reruns don't collide on the unique index."""
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@pytest.fixture(autouse=True)
async def cleanup_test_users():
    """Remove rows this suite created, leaving the dev database as it was."""
    yield
    async with AsyncSessionLocal() as session:
        await session.execute(delete(User).where(User.email.like("test-%@example.com")))
        await session.commit()
