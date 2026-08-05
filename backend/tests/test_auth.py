import pytest

from app.config import get_settings

settings = get_settings()
PASSWORD = "supersecret123"


async def register(client, email: str, password: str = PASSWORD):
    return await client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "full_name": "Test User"},
    )


@pytest.mark.asyncio
async def test_register_returns_token_and_user(client, unique_email):
    response = await register(client, unique_email)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == unique_email
    # The hash must never reach the client.
    assert "hashed_password" not in body["user"]
    assert "password" not in body["user"]


@pytest.mark.asyncio
async def test_refresh_token_is_httponly_cookie_not_body(client, unique_email):
    response = await register(client, unique_email)

    assert "refresh_token" not in response.json()

    cookie = response.cookies.get(settings.refresh_cookie_name)
    assert cookie, "refresh token cookie was not set"

    set_cookie_header = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie_header
    assert "samesite=lax" in set_cookie_header


@pytest.mark.asyncio
async def test_email_is_normalized_and_login_is_case_insensitive(client, unique_email):
    await register(client, unique_email.upper())

    response = await client.post(
        "/api/auth/login", json={"email": unique_email, "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == unique_email.lower()


@pytest.mark.asyncio
async def test_duplicate_registration_conflicts(client, unique_email):
    await register(client, unique_email)
    response = await register(client, unique_email)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_short_password_rejected(client, unique_email):
    response = await register(client, unique_email, password="short")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_wrong_password_and_unknown_email_are_indistinguishable(client, unique_email):
    await register(client, unique_email)

    wrong = await client.post(
        "/api/auth/login", json={"email": unique_email, "password": "not-the-password"}
    )
    unknown = await client.post(
        "/api/auth/login",
        json={"email": "test-nobody@example.com", "password": "not-the-password"},
    )

    # Identical status and body, or the endpoint reveals which emails exist.
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


@pytest.mark.asyncio
async def test_me_requires_authentication(client):
    assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_me_returns_current_user(client, unique_email):
    token = (await register(client, unique_email)).json()["access_token"]

    response = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 200
    assert response.json()["email"] == unique_email


@pytest.mark.asyncio
async def test_refresh_token_rejected_as_access_token(client, unique_email):
    await register(client, unique_email)
    refresh_token = client.cookies.get(settings.refresh_cookie_name)

    response = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {refresh_token}"}
    )

    # Without the "type" claim check this would succeed, handing every API
    # call a 7-day credential.
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_garbage_token_rejected(client):
    response = await client.get(
        "/api/auth/me", headers={"Authorization": "Bearer not.a.real.token"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_issues_new_access_token(client, unique_email):
    await register(client, unique_email)

    response = await client.post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.json()["access_token"]


@pytest.mark.asyncio
async def test_refresh_without_cookie_is_unauthorized(client):
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout_clears_cookie_and_blocks_refresh(client, unique_email):
    await register(client, unique_email)

    logout = await client.post("/api/auth/logout")
    assert logout.status_code == 204

    assert (await client.post("/api/auth/refresh")).status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_the_token_itself(client, unique_email):
    """Clearing the cookie isn't enough — a copy of the token must stop working."""
    await register(client, unique_email)
    stolen = client.cookies.get(settings.refresh_cookie_name)

    await client.post("/api/auth/logout")

    # Replay the token as if it had been captured before logout.
    response = await client.post(
        "/api/auth/refresh", cookies={settings.refresh_cookie_name: stolen}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_is_rate_limited(client, unique_email):
    await register(client, unique_email)

    statuses = []
    for _ in range(settings.auth_rate_limit_attempts + 2):
        response = await client.post(
            "/api/auth/login", json={"email": unique_email, "password": "wrong"}
        )
        statuses.append(response.status_code)

    assert 429 in statuses, f"expected a 429 within {len(statuses)} attempts, got {statuses}"


@pytest.mark.asyncio
async def test_google_oauth_unconfigured_returns_503(client):
    if settings.google_oauth_client_id and settings.google_oauth_client_secret:
        pytest.skip("Google OAuth is configured in this environment")

    response = await client.get("/api/auth/google/authorize")

    assert response.status_code == 503
