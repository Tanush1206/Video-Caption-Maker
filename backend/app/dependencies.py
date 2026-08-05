"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.database import get_db
from app.models.user import User
from app.services.auth import get_user_by_id
from app.utils.security import TokenError, decode_token

# auto_error=False so a missing header produces our own 401 with a
# WWW-Authenticate hint rather than FastAPI's bare 403.
_bearer_scheme = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Resolve the bearer access token to a User, or raise 401.

    The DB lookup on every request is deliberate: it means deactivating an
    account takes effect immediately rather than whenever the token expires.
    """
    if credentials is None:
        raise _CREDENTIALS_EXCEPTION

    try:
        payload = decode_token(credentials.credentials, expected_type="access")
    except TokenError:
        raise _CREDENTIALS_EXCEPTION from None

    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise _CREDENTIALS_EXCEPTION from None

    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXCEPTION

    return user


# Shorthands so routes read as: async def route(user: CurrentUser, db: DbSession)
CurrentUser = Annotated[User, Depends(get_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db)]

__all__ = [
    "get_settings",
    "Settings",
    "get_current_user",
    "CurrentUser",
    "DbSession",
]
