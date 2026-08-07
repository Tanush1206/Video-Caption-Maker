import shutil
import subprocess
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.database import AsyncSessionLocal
from app.main import app
from app.models.user import User
from app.services import storage
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
    """
    Remove rows this suite created, leaving the dev database as it was.

    Deleting the user cascades to their videos, but not to the files on disk,
    so afterwards any storage directory without a matching user is swept up.
    That self-corrects rather than tracking ids: whatever is orphaned goes.
    """
    yield

    async with AsyncSessionLocal() as session:
        await session.execute(delete(User).where(User.email.like("test-%@example.com")))
        await session.commit()

        live_ids = {
            f"user_{row}" for row in (await session.execute(select(User.id))).scalars().all()
        }

    root = storage.storage_root()
    for entry in root.glob("user_*"):
        if entry.is_dir() and entry.name not in live_ids:
            shutil.rmtree(entry, ignore_errors=True)


def _build_video(*extra_input_args: str, with_audio: bool) -> bytes:
    """Render a short MP4 with FFmpeg and return its bytes."""
    destination = storage.storage_root() / f"_pytest_sample_{uuid.uuid4().hex[:8]}.mp4"

    command = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=15",
        *extra_input_args,
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]
    if with_audio:
        command += ["-c:a", "aac", "-shortest"]

    subprocess.run([*command, str(destination)], capture_output=True, timeout=120)

    try:
        return destination.read_bytes()
    finally:
        destination.unlink(missing_ok=True)


@pytest.fixture(scope="session")
def sample_video_bytes() -> bytes:
    """
    A genuinely valid 1-second MP4 with an audio track.

    Real bytes matter here: ffprobe has to read it for the duration and
    thumbnail assertions to mean anything, and random bytes with an .mp4 name
    would pass the upload while silently skipping everything worth testing.

    The audio track matters too — the first version of this fixture was
    video-only, which made audio extraction fail in a way real uploads
    wouldn't. See sample_silent_video_bytes for that case, tested deliberately.
    """
    return _build_video(
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", with_audio=True
    )


@pytest.fixture(scope="session")
def sample_silent_video_bytes() -> bytes:
    """A valid MP4 with no audio stream at all."""
    return _build_video(with_audio=False)


@pytest.fixture
async def auth_headers(client, unique_email) -> dict[str, str]:
    """Register a throwaway user and return their bearer header."""
    response = await client.post(
        "/api/auth/register",
        json={"email": unique_email, "password": "supersecret123"},
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
async def second_user_headers(client) -> dict[str, str]:
    """A different user, for proving one account cannot reach another's data."""
    email = f"test-{uuid.uuid4().hex[:12]}@example.com"
    response = await client.post(
        "/api/auth/register", json={"email": email, "password": "supersecret123"}
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
