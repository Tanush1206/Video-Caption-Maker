"""
The install itself: what it runs on, and the few settings a user can change.

Read by the Settings page, and by the frontend at start-up to learn whether
this is a local install (no login) and whether a Gemini key is set (which
decides whether search offers written answers).
"""

from fastapi import APIRouter, HTTPException, status

from app.config import get_settings
from app.dependencies import CurrentUser, DbSession
from app.schemas.system import (
    Choice,
    HardwareInfo,
    SystemInfo,
    SystemSettingsUpdate,
    WhisperInfo,
)
from app.services import app_settings, hardware

router = APIRouter(prefix="/system", tags=["system"])


async def _info(db) -> SystemInfo:
    settings = get_settings()
    report = await app_settings.worker_hardware(db)
    choice = await app_settings.whisper_override(db) or hardware.AUTO
    stored = await app_settings.get_value(db, app_settings.GEMINI_API_KEY)
    key = stored or settings.gemini_api_key

    hw = whisper = translator = None
    if report:
        fields = {name: report.get(name) for name in HardwareInfo.model_fields}
        hw = HardwareInfo(**fields)
        detected = hardware.Hardware(**fields)
        profile = hardware.whisper_profile(detected, choice)
        whisper = WhisperInfo(**profile.__dict__)
        translator = hardware.translator_profile(detected).model

    return SystemInfo(
        auth_mode="local" if settings.is_local_mode else "accounts",
        hardware=hw,
        whisper=whisper,
        whisper_choice=choice,
        whisper_choices=[Choice(value=hardware.AUTO, label="Automatic (recommended)")]
        + [Choice(value=value, label=label) for value, label in hardware.WHISPER_CHOICES.items()],
        translation_engine="gemini" if key else "local",
        translator_model=translator,
        gemini_configured=bool(key),
        gemini_source="settings" if stored else ("env" if key else None),
    )


@router.get("", response_model=SystemInfo)
async def system_info(user: CurrentUser, db: DbSession) -> SystemInfo:
    return await _info(db)


@router.patch("/settings", response_model=SystemInfo)
async def update_settings(
    payload: SystemSettingsUpdate, user: CurrentUser, db: DbSession
) -> SystemInfo:
    # These are install-wide. On a multi-user deployment one account must not
    # be able to swap the key or the model out from under everyone else.
    if not get_settings().is_local_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Install settings can only be changed on a local install",
        )

    fields = payload.model_fields_set
    if "whisper_model" in fields:
        model = payload.whisper_model or hardware.AUTO
        if model != hardware.AUTO and model not in hardware.WHISPER_CHOICES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Unknown speech model",
            )
        await app_settings.set_value(
            db, app_settings.WHISPER_MODEL, None if model == hardware.AUTO else model
        )
    if "gemini_api_key" in fields:
        await app_settings.set_value(db, app_settings.GEMINI_API_KEY, payload.gemini_api_key)

    return await _info(db)
