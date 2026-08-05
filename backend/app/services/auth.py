"""User lookup and creation. Route handlers stay thin; the DB logic lives here."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.utils.security import hash_password, verify_password


def normalize_email(email: str) -> str:
    """
    Emails are matched case-insensitively. Storing them lowercased keeps the
    unique index meaningful — otherwise Alice@x.com and alice@x.com are two
    different accounts.
    """
    return email.strip().lower()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == normalize_email(email)))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def get_user_by_google_id(db: AsyncSession, google_id: str) -> User | None:
    result = await db.execute(select(User).where(User.google_id == google_id))
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    *,
    email: str,
    password: str | None = None,
    full_name: str | None = None,
    google_id: str | None = None,
) -> User:
    user = User(
        email=normalize_email(email),
        hashed_password=hash_password(password) if password else None,
        full_name=full_name,
        google_id=google_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    """
    Returns the user on success, None on any failure.

    The caller must not distinguish "no such email" from "wrong password" in
    its response, or the endpoint becomes an account-existence oracle.
    """
    user = await get_user_by_email(db, email)

    if user is None:
        # Still run a hash comparison so a missing account isn't detectably
        # faster than a wrong password.
        verify_password(password, None)
        return None

    if not verify_password(password, user.hashed_password):
        return None

    if not user.is_active:
        return None

    return user
