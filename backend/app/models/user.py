from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)

    # 320 = max length of an email address per RFC 3696 (64 local + @ + 255 domain).
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)

    # Nullable: accounts created through Google OAuth never set a password.
    # A NULL here means "this account cannot log in with a password".
    hashed_password: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Google's stable subject identifier. Unique so two accounts can't claim
    # the same Google identity.
    google_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )

    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Soft-disable switch: keeps the row (and its videos) while blocking login.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    videos = relationship(
        "Video", back_populates="owner", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User id={self.id} email={self.email!r}>"
