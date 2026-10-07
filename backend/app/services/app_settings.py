"""
Reading and writing install-wide settings.

The Gemini key is the one value here that is a secret. It is written by the
API, read by the worker, and never sent back out: the API reports only
whether one is set. Nothing in this module logs a value.
"""

import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.app_setting import AppSetting

GEMINI_API_KEY = "gemini_api_key"
WHISPER_MODEL = "whisper_model"
# Written by the worker when it starts: only it can see the GPU.
WORKER_HARDWARE = "worker_hardware"


async def get_value(session: AsyncSession, key: str) -> str | None:
    row = await session.get(AppSetting, key)
    return row.value if row else None


async def set_value(session: AsyncSession, key: str, value: str | None) -> None:
    """Store a value, or remove it when `value` is None or blank."""
    if value is None or not value.strip():
        await session.execute(delete(AppSetting).where(AppSetting.key == key))
    else:
        row = await session.get(AppSetting, key)
        if row is None:
            session.add(AppSetting(key=key, value=value.strip()))
        else:
            row.value = value.strip()
    await session.commit()


async def get_all(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(AppSetting))).scalars()
    return {row.key: row.value for row in rows}


async def gemini_key(session: AsyncSession) -> str:
    """
    The key to call Gemini with, or "" for none.

    One pasted into Settings wins over the environment. The environment one is
    kept as a fallback for a hosted deployment configured the usual way.
    """
    return (await get_value(session, GEMINI_API_KEY)) or get_settings().gemini_api_key


async def whisper_override(session: AsyncSession) -> str | None:
    return await get_value(session, WHISPER_MODEL)


async def worker_hardware(session: AsyncSession) -> dict | None:
    raw = await get_value(session, WORKER_HARDWARE)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
