from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    # bcrypt silently truncates beyond 72 bytes, so reject longer passwords
    # outright rather than accepting one that isn't fully checked at login.
    password: str = Field(min_length=8, max_length=72)
    full_name: str | None = Field(default=None, max_length=255)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class UserRead(BaseModel):
    """What the API returns for a user. Never includes the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str | None
    is_active: bool
    created_at: datetime


class UserUpdate(BaseModel):
    """
    Editable profile fields.

    Email is absent on purpose: changing it safely means proving the new
    address before the old one stops working, and there is no mail delivery
    here to prove it with.
    """

    full_name: str | None = Field(default=None, max_length=255)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class AccountDelete(BaseModel):
    """
    Confirmation for an irreversible action.

    A bearer token alone is not enough here. The session may have been left
    open on a shared machine, and unlike every other destructive route in this
    app there is nothing to restore afterwards.

    Which field is required depends on the account. Google-only accounts have
    no password to check, so they confirm by typing their own address — weaker
    proof, but it still turns one careless click into a deliberate act, which
    is what this guard is for.
    """

    password: str | None = Field(default=None, max_length=72)
    confirm_email: EmailStr | None = None


class TokenResponse(BaseModel):
    """
    The refresh token is deliberately absent: it goes out as an httpOnly
    cookie so JavaScript can never read it.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead
