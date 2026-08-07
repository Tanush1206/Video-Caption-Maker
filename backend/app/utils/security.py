"""
Password hashing and JWT issuing/verification.

bcrypt is used directly rather than through passlib: passlib 1.7.4 (its last
release, 2020) probes its backend with an over-length test password, which
bcrypt >= 5 rejects instead of truncating, breaking every hash call.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import uuid4

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings

settings = get_settings()

TokenType = Literal["access", "refresh", "stream"]

# bcrypt only considers the first 72 bytes of a password. Rather than let it
# silently truncate, we reject longer input at the edges.
BCRYPT_MAX_BYTES = 72

# Used to burn roughly the same CPU time when an account has no password
# (Google-only) as a real comparison would, so response timing doesn't reveal
# which emails are registered.
_DUMMY_HASH = bcrypt.hashpw(b"timing-attack-placeholder", bcrypt.gensalt()).decode()


class TokenError(Exception):
    """Raised when a token is malformed, expired, or the wrong type."""


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed_password: str | None) -> bool:
    """
    Returns False rather than raising for any bad input — a login attempt with
    a malformed password or a passwordless account is a failed login, not a
    server error.
    """
    if not hashed_password:
        # Equalise timing against the "user exists with a password" path.
        bcrypt.checkpw(b"x", _DUMMY_HASH.encode("utf-8"))
        return False

    encoded = password.encode("utf-8")
    if len(encoded) > BCRYPT_MAX_BYTES:
        return False

    try:
        return bcrypt.checkpw(encoded, hashed_password.encode("utf-8"))
    except ValueError:
        return False


def _create_token(
    subject: str | int,
    token_type: TokenType,
    lifetime: timedelta,
    **claims: Any,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
        # Unique per token, so individual refresh tokens can be revoked later.
        "jti": uuid4().hex,
        **claims,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str | int) -> str:
    return _create_token(
        user_id, "access", timedelta(minutes=settings.access_token_expire_minutes)
    )


def create_refresh_token(user_id: str | int) -> str:
    return _create_token(
        user_id, "refresh", timedelta(days=settings.refresh_token_expire_days)
    )


def create_stream_token(user_id: str | int, video_id: int) -> str:
    """
    A short-lived credential for one video file, passed in the query string.

    A <video> element cannot send an Authorization header, so the URL itself
    has to carry proof. Query strings leak — into browser history, Referer
    headers, and access logs — so this token is deliberately weak: it expires
    within the hour, and the `vid` claim binds it to a single video, so a
    leaked one cannot be replayed against another file or used as an API
    credential.
    """
    return _create_token(
        user_id,
        "stream",
        timedelta(minutes=settings.stream_token_expire_minutes),
        vid=video_id,
    )


def stream_token_max_age() -> int:
    """Stream-token lifetime in seconds, so the client can re-issue before it dies."""
    return settings.stream_token_expire_minutes * 60


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    """
    Decode and validate a token, raising TokenError on any problem.

    `expected_type` matters: without it, a refresh token would be accepted as
    an access token, silently granting a 7-day credential to every API call.
    """
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError(str(exc)) from exc

    if payload.get("type") != expected_type:
        raise TokenError(f"Expected a {expected_type} token")

    if not payload.get("sub"):
        raise TokenError("Token is missing a subject")

    return payload


def access_token_max_age() -> int:
    """Access-token lifetime in seconds, for the `expires_in` response field."""
    return settings.access_token_expire_minutes * 60


def refresh_token_max_age() -> int:
    """Refresh-token lifetime in seconds, for the cookie's Max-Age."""
    return settings.refresh_token_expire_days * 24 * 60 * 60
