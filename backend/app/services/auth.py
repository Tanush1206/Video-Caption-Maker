"""User lookup and creation. Route handlers stay thin; the DB logic lives here."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.video import Video
from app.services import storage
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


# The one account on a local install. Not a real address: nothing is ever sent
# to it, and `.localdomain` passes email validation where `.local` does not.
LOCAL_USER_EMAIL = "local-user@localhost.localdomain"


async def get_or_create_local_user(db: AsyncSession) -> User:
    """
    The single user a local install acts as, created on first use.

    No password and no Google id, so it cannot be signed into — there is
    nothing to sign into. Two first requests racing each other both try to
    insert; the loser hits the unique email and reads the winner's row.
    """
    user = await get_user_by_email(db, LOCAL_USER_EMAIL)
    if user is not None:
        return user
    try:
        return await create_user(db, email=LOCAL_USER_EMAIL, full_name="You")
    except IntegrityError:
        await db.rollback()
        user = await get_user_by_email(db, LOCAL_USER_EMAIL)
        if user is None:
            raise
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


def verify_password_for(user: User, password: str) -> bool:
    """
    Re-check a signed-in user's password before a sensitive action.

    Distinct from authenticate_user, which is a login: that one must not
    reveal whether an account exists, so it takes an email and hides its
    reasons. Here the account is already known, and the only question is
    whether the person at the keyboard is the one who owns it.
    """
    return verify_password(password, user.hashed_password)


async def update_profile(db: AsyncSession, user: User, *, full_name: str | None) -> User:
    """
    Change the display name.

    Email is deliberately not editable here. Changing it would need the new
    address proved before the old one stops working, and we have no mail
    delivery — an unverified change would let someone point an account at an
    address they do not control and then use "forgot password" on it.
    """
    user.full_name = full_name
    await db.commit()
    await db.refresh(user)
    return user


async def change_password(db: AsyncSession, user: User, new_password: str) -> User:
    """
    Set a new password and invalidate every session issued before now.

    The caller must already have checked the current password. Moving
    sessions_valid_from is the point of the operation as much as the new hash
    is: someone changing their password after a laptop is stolen expects that
    laptop to stop working, and a JWT that has already been signed cannot be
    unsigned. Access tokens still work until they expire — up to their normal
    lifetime — because checking a denylist on every request would give up the
    only thing stateless access tokens buy us.
    """
    user.hashed_password = hash_password(new_password)
    user.sessions_valid_from = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


def sessions_are_stale(user: User, issued_at: int | None) -> bool:
    """
    Was this token issued before the user's sessions were invalidated?

    A token with no `iat` is treated as stale. Every token we mint has one, so
    a missing claim means the token did not come from us in the shape we
    expect, and refusing is the safe reading.
    """
    if user.sessions_valid_from is None:
        return False

    if issued_at is None:
        return True

    # int() on the boundary, not just on the comparison. `iat` is whole
    # seconds; sessions_valid_from is microsecond-precise. Compared directly,
    # a password changed at 12:00:00.7 would stamp a token issued at
    # 12:00:00.0 as stale — including the replacement token minted by that
    # very request, logging the user out of the browser they just used.
    #
    # The cost is one second of slack, in which a token issued just before the
    # change survives. That is the right trade against certain self-eviction.
    return issued_at < int(user.sessions_valid_from.timestamp())


async def delete_account(db: AsyncSession, user: User) -> None:
    """
    Erase the account and everything it owns.

    Order matters and is the mirror of delete_video: the vectors go first,
    because they live in a store with no foreign keys and the video ids that
    identify them are about to stop existing. Once the row is gone there is no
    way left to find them, and they would answer searches forever.

    Files go last. An orphaned file wastes disk; a row pointing at a file that
    is already gone breaks playback. If this is interrupted halfway, losing the
    less damaging one is the better outcome.
    """
    video_ids = list(
        (await db.execute(select(Video.id).where(Video.owner_id == user.id))).scalars().all()
    )

    # Imported lazily so the API process never loads the ML stack at startup.
    from app.services.embeddings import delete_video_vectors

    for video_id in video_ids:
        delete_video_vectors(video_id)

    user_id = user.id

    # Videos, captions, styles and exports all go with this via ON DELETE
    # CASCADE — the database enforces it, so there is no list here to fall out
    # of date when a table is added.
    await db.delete(user)
    await db.commit()

    storage.delete_user_files(user_id)
