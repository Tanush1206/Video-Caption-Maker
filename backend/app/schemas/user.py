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


class TokenResponse(BaseModel):
    """
    The refresh token is deliberately absent: it goes out as an httpOnly
    cookie so JavaScript can never read it.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead
