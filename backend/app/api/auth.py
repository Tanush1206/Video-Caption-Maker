"""Authentication routes: password auth, token refresh, and Google OAuth."""

import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.dependencies import CurrentUser, DbSession
from app.schemas.user import TokenResponse, UserCreate, UserLogin, UserRead
from app.services import auth as auth_service
from app.utils.rate_limit import (
    RateLimitExceeded,
    enforce_rate_limit,
    get_redis,
    reset_rate_limit,
)
from app.utils.token_denylist import is_revoked, revoke_token
from app.utils.security import (
    TokenError,
    access_token_max_age,
    create_access_token,
    create_refresh_token,
    decode_token,
    refresh_token_max_age,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo"

# OAuth state lives in Redis rather than a signed session cookie: it avoids a
# session-middleware dependency and works unchanged across multiple API
# instances, where an in-process store would not.
_OAUTH_STATE_TTL_SECONDS = 600

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
)


def _client_ip(request: Request) -> str:
    """
    Best-effort client IP for rate-limit bucketing.

    Behind a reverse proxy this needs X-Forwarded-For plus a trusted-proxy
    list; direct-to-uvicorn in dev, request.client is correct.
    """
    return request.client.host if request.client else "unknown"


async def _limit(bucket: str) -> None:
    try:
        await enforce_rate_limit(
            bucket,
            limit=settings.auth_rate_limit_attempts,
            window_seconds=settings.auth_rate_limit_window_seconds,
        )
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,  # unreadable from JavaScript, so XSS can't exfiltrate it
        secure=settings.is_production,  # dev is plain http://localhost
        samesite="lax",
        max_age=refresh_token_max_age(),
        # Scoped to the auth routes, so it isn't attached to every API call.
        path="/api/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path="/api/auth",
    )


def _token_response(user, response: Response) -> TokenResponse:
    _set_refresh_cookie(response, create_refresh_token(user.id))
    return TokenResponse(
        access_token=create_access_token(user.id),
        expires_in=access_token_max_age(),
        user=UserRead.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserCreate, request: Request, response: Response, db: DbSession
) -> TokenResponse:
    await _limit(f"register:ip:{_client_ip(request)}")

    if await auth_service.get_user_by_email(db, payload.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    try:
        user = await auth_service.create_user(
            db,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
        )
    except IntegrityError:
        # Two concurrent registrations for the same email; the unique index
        # is the real guard, the check above is just for a nicer message.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        ) from None

    return _token_response(user, response)


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: UserLogin, request: Request, response: Response, db: DbSession
) -> TokenResponse:
    ip_bucket = f"login:ip:{_client_ip(request)}"
    email_bucket = f"login:email:{auth_service.normalize_email(payload.email)}"

    # Both buckets: the IP limit stops one host spraying many accounts, the
    # email limit stops a botnet spraying one account from many hosts.
    await _limit(ip_bucket)
    await _limit(email_bucket)

    user = await auth_service.authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise _INVALID_CREDENTIALS

    await reset_rate_limit(ip_bucket)
    await reset_rate_limit(email_bucket)

    return _token_response(user, response)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: DbSession) -> TokenResponse:
    """Exchange the refresh cookie for a fresh access token."""
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token"
        )

    try:
        payload = decode_token(token, expected_type="refresh")
    except TokenError:
        # Clear the bad cookie so the browser stops re-sending it.
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from None

    if await is_revoked(payload):
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )

    user = await auth_service.get_user_by_id(db, int(payload["sub"]))
    if user is None or not user.is_active:
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )

    # A new refresh token goes out with every refresh. The old one is left
    # valid until it expires rather than revoked here: revoking it would make
    # two concurrent refreshes (two browser tabs) log the user out.
    return _token_response(user, response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    # The cookie must be cleared on the response we actually return — headers
    # set on an injected Response are discarded when a different one is returned.
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)

    token = request.cookies.get(settings.refresh_cookie_name)
    if token:
        try:
            await revoke_token(decode_token(token, expected_type="refresh"))
        except TokenError:
            pass  # already invalid; nothing to revoke

    return response


@router.get("/me", response_model=UserRead)
async def read_current_user(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


# ── Google OAuth ─────────────────────────────────────────────────────────


def _require_google_config() -> None:
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID and "
                "GOOGLE_OAUTH_CLIENT_SECRET in .env."
            ),
        )


@router.get("/google/authorize")
async def google_authorize() -> RedirectResponse:
    """Start the OAuth flow by redirecting to Google's consent screen."""
    _require_google_config()

    state = secrets.token_urlsafe(32)
    await get_redis().setex(f"oauth:state:{state}", _OAUTH_STATE_TTL_SECONDS, "1")

    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(
    request: Request, db: DbSession, code: str | None = None, state: str | None = None
) -> RedirectResponse:
    _require_google_config()

    if not code or not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing code or state"
        )

    # Single-use state check — this is the CSRF guard for the callback.
    if not await get_redis().delete(f"oauth:state:{state}"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired state"
        )

    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": settings.google_oauth_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            logger.warning("Google token exchange failed: %s", token_res.text)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Google sign-in failed"
            )

        userinfo_res = await client.get(
            GOOGLE_USERINFO_ENDPOINT,
            headers={"Authorization": f"Bearer {token_res.json()['access_token']}"},
        )
        if userinfo_res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Google sign-in failed"
            )

    info = userinfo_res.json()
    google_id, email = info.get("sub"), info.get("email")
    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Google account has no email"
        )
    if not info.get("email_verified", False):
        # Without this, anyone could claim an unverified address matching an
        # existing password account and take it over.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Google email is not verified"
        )

    user = await auth_service.get_user_by_google_id(db, google_id)
    if user is None:
        user = await auth_service.get_user_by_email(db, email)
        if user is None:
            user = await auth_service.create_user(
                db, email=email, full_name=info.get("name"), google_id=google_id
            )
        else:
            # Existing password account, same verified email: link them.
            user.google_id = google_id
            await db.commit()
            await db.refresh(user)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    # The access token is deliberately NOT put in the redirect URL, where it
    # would land in browser history and referrer headers. Only the httpOnly
    # refresh cookie is set; the frontend calls /refresh to get an access token.
    redirect = RedirectResponse(f"{settings.frontend_url}/dashboard")
    _set_refresh_cookie(redirect, create_refresh_token(user.id))
    return redirect
