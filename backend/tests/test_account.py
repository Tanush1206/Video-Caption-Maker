"""Profile edits, password changes, and account deletion."""

import uuid

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models.user import User
from app.services import storage

settings = get_settings()

PASSWORD = "supersecret123"
COOKIE = settings.refresh_cookie_name


async def _register(client) -> tuple[dict[str, str], str, str]:
    """A fresh account; returns (headers, email, refresh token)."""
    email = f"test-{uuid.uuid4().hex[:12]}@example.com"
    response = await client.post(
        "/api/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 201
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    return headers, email, response.cookies[COOKIE]


# ── profile ──────────────────────────────────────────────────────────────


async def test_profile_requires_authentication(client):
    assert (await client.patch("/api/auth/me", json={"full_name": "x"})).status_code == 401


async def test_name_can_be_set_and_cleared(client, auth_headers):
    updated = await client.patch(
        "/api/auth/me", headers=auth_headers, json={"full_name": "Ada Lovelace"}
    )
    assert updated.status_code == 200
    assert updated.json()["full_name"] == "Ada Lovelace"

    cleared = await client.patch("/api/auth/me", headers=auth_headers, json={"full_name": None})
    assert cleared.json()["full_name"] is None


async def test_a_whitespace_name_is_stored_as_nothing(client, auth_headers):
    """
    Otherwise the name is technically set, and every place that renders it
    shows a blank line while the "add your name" prompt stays hidden.
    """
    response = await client.patch(
        "/api/auth/me", headers=auth_headers, json={"full_name": "   "}
    )
    assert response.json()["full_name"] is None


async def test_email_cannot_be_changed_through_the_profile(client, auth_headers):
    """
    Unknown fields are ignored rather than honoured. Changing an address
    safely needs the new one proved before the old one stops working, and
    there is no mail delivery here to prove it with.
    """
    before = (await client.get("/api/auth/me", headers=auth_headers)).json()["email"]

    await client.patch(
        "/api/auth/me", headers=auth_headers, json={"email": "attacker@example.com"}
    )

    after = (await client.get("/api/auth/me", headers=auth_headers)).json()["email"]
    assert after == before


# ── password ─────────────────────────────────────────────────────────────


async def test_wrong_current_password_is_refused(client, auth_headers):
    response = await client.post(
        "/api/auth/me/password",
        headers=auth_headers,
        json={"current_password": "not-my-password", "new_password": "brandnewpass1"},
    )
    assert response.status_code == 400


async def test_short_new_password_is_refused(client, auth_headers):
    response = await client.post(
        "/api/auth/me/password",
        headers=auth_headers,
        json={"current_password": PASSWORD, "new_password": "short"},
    )
    assert response.status_code == 422


async def test_password_change_takes_effect_at_login(client):
    headers, email, _ = await _register(client)

    changed = await client.post(
        "/api/auth/me/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "a-much-better-one"},
    )
    assert changed.status_code == 200

    old = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert old.status_code == 401

    new = await client.post(
        "/api/auth/login", json={"email": email, "password": "a-much-better-one"}
    )
    assert new.status_code == 200


async def test_changing_a_password_kills_sessions_it_never_saw(client):
    """
    The point of the whole sessions_valid_from column.

    A refresh token already signed cannot be unsigned, and the denylist can
    only revoke tokens we can name — we cannot enumerate one user's
    outstanding jtis. So a stolen laptop's session has to die by a rule, not
    by a list. Here the "other session" is a second refresh token this request
    knows nothing about.
    """
    headers, email, _ = await _register(client)

    # A second sign-in: a different device, a token the change never touches.
    other = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    other_refresh = other.cookies[COOKIE]

    # It works before the change.
    client.cookies.set(COOKIE, other_refresh)
    assert (await client.post("/api/auth/refresh")).status_code == 200

    await client.post(
        "/api/auth/me/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "a-much-better-one"},
    )

    client.cookies.set(COOKIE, other_refresh)
    assert (await client.post("/api/auth/refresh")).status_code == 401


async def test_the_session_that_changed_the_password_survives(client):
    """
    The truncation trap.

    `iat` is whole seconds; sessions_valid_from is microsecond-precise. Compare
    them directly and a password changed at 12:00:00.7 stamps the replacement
    token issued at 12:00:00.0 as stale — so doing the responsible thing logs
    you out of the browser you are sitting in front of.
    """
    headers, _, _ = await _register(client)

    changed = await client.post(
        "/api/auth/me/password",
        headers=headers,
        json={"current_password": PASSWORD, "new_password": "a-much-better-one"},
    )
    assert changed.status_code == 200

    client.cookies.set(COOKIE, changed.cookies[COOKIE])
    assert (await client.post("/api/auth/refresh")).status_code == 200


async def test_google_only_accounts_have_no_password_to_change(
    client, auth_headers, db_session
):
    """
    Setting a first password on a session's say-so would be an escalation: the
    session dies in days, a password lasts forever. With no email delivery
    there is nothing to prove the request with, so it is refused.
    """
    me = (await client.get("/api/auth/me", headers=auth_headers)).json()
    user = await db_session.get(User, me["id"])
    user.hashed_password = None
    await db_session.commit()

    response = await client.post(
        "/api/auth/me/password",
        headers=auth_headers,
        json={"current_password": PASSWORD, "new_password": "brandnewpass1"},
    )
    assert response.status_code == 400
    assert "Google" in response.json()["detail"]


# ── deletion ─────────────────────────────────────────────────────────────


async def test_deletion_needs_the_password(client, auth_headers):
    response = await client.request(
        "DELETE", "/api/auth/me", headers=auth_headers, json={"password": "wrong"}
    )
    assert response.status_code == 400

    assert (await client.get("/api/auth/me", headers=auth_headers)).status_code == 200


async def test_deletion_needs_more_than_a_token(client, auth_headers):
    """
    A bearer token alone is not proof enough for the one action with nothing
    to undo it — the session may have been left open on a shared machine.
    """
    response = await client.request("DELETE", "/api/auth/me", headers=auth_headers, json={})
    assert response.status_code == 400


async def test_deletion_removes_the_user_and_their_videos(
    client, sample_video_bytes, db_session
):
    headers, _, _ = await _register(client)

    upload = await client.post(
        "/api/videos", headers=headers, files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")}
    )
    assert upload.status_code == 201
    user_id = (await client.get("/api/auth/me", headers=headers)).json()["id"]

    response = await client.request(
        "DELETE", "/api/auth/me", headers=headers, json={"password": PASSWORD}
    )
    assert response.status_code == 204

    assert await db_session.get(User, user_id) is None

    from app.models.video import Video

    remaining = (
        await db_session.execute(select(Video).where(Video.owner_id == user_id))
    ).scalars().all()
    assert remaining == []


async def test_deletion_removes_the_files_too(client, sample_video_bytes):
    """
    Postgres cascades to the video rows; the filesystem has no foreign keys.
    Without the explicit sweep the bytes stay on disk forever with nothing
    left pointing at them.
    """
    headers, _, _ = await _register(client)

    await client.post(
        "/api/videos", headers=headers, files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")}
    )
    user_id = (await client.get("/api/auth/me", headers=headers)).json()["id"]
    user_dir = storage.storage_root() / f"user_{user_id}"
    assert user_dir.exists()

    await client.request("DELETE", "/api/auth/me", headers=headers, json={"password": PASSWORD})

    assert not user_dir.exists()


async def test_a_deleted_account_cannot_sign_back_in(client):
    headers, email, _ = await _register(client)

    await client.request("DELETE", "/api/auth/me", headers=headers, json={"password": PASSWORD})

    response = await client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 401


async def test_deleting_one_account_leaves_the_other_alone(
    client, second_user_headers, sample_video_bytes
):
    headers, _, _ = await _register(client)
    await client.post(
        "/api/videos",
        headers=second_user_headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
    )

    await client.request("DELETE", "/api/auth/me", headers=headers, json={"password": PASSWORD})

    survivor = await client.get("/api/videos", headers=second_user_headers)
    assert survivor.status_code == 200
    assert survivor.json()["total"] == 1


@pytest.mark.parametrize(
    "method,path", [("PATCH", "/api/auth/me"), ("DELETE", "/api/auth/me"), ("POST", "/api/auth/me/password")]
)
async def test_account_routes_reject_anonymous_callers(client, method, path):
    response = await client.request(method, path, json={})
    assert response.status_code == 401
