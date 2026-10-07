"""
Install-wide settings changed at runtime.

Environment variables are fixed when a container starts, and the person using
a local install should never have to edit an env file to paste in an API key
or pick a smaller model. These live in the database instead, where the API
writes them and the worker reads them at the start of each job.

Key/value rather than a column per setting: the set is small, grows rarely,
and nothing ever queries across it.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
