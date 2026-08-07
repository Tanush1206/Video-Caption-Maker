"""Caption appearance routes."""

import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies import CurrentUser, DbSession
from app.schemas.caption_style import (
    CaptionStyleRead,
    CaptionStyleUpdate,
    FontRead,
    PresetApply,
    StyleOptions,
)
from app.services import caption_style as style_service
from app.services import video as video_service

logger = logging.getLogger(__name__)

router = APIRouter()


async def _require_owned(db, video_id: int, user_id: int):
    # Duplicated from the videos router rather than imported: a private helper
    # is not an interface. If a third router needs it, it moves to a shared
    # dependency then.
    video = await video_service.get_owned_video(db, video_id, user_id)
    if video is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
    return video


@router.get("/styles/options", response_model=StyleOptions, tags=["styles"])
async def list_style_options() -> StyleOptions:
    """
    The fonts and presets the editor may offer.

    Served rather than hardcoded in the frontend so the list cannot drift from
    the fonts actually installed in the worker image — offering one that isn't
    there means libass substitutes it and the preview quietly stops matching.

    No auth: this is a static description of the app's capabilities, identical
    for everyone, and gates nothing.
    """
    return StyleOptions(
        fonts=[
            FontRead(key=font.key, label=font.label, css_stack=font.css_stack)
            for font in style_service.FONTS
        ],
        presets=list(style_service.PRESETS),
    )


@router.get("/videos/{video_id}/style", response_model=CaptionStyleRead, tags=["styles"])
async def get_style(video_id: int, user: CurrentUser, db: DbSession) -> CaptionStyleRead:
    await _require_owned(db, video_id, user.id)
    style = await style_service.get_or_create_style(db, video_id)
    return CaptionStyleRead.model_validate(style)


@router.patch("/videos/{video_id}/style", response_model=CaptionStyleRead, tags=["styles"])
async def update_style(
    video_id: int, payload: CaptionStyleUpdate, user: CurrentUser, db: DbSession
) -> CaptionStyleRead:
    """
    PATCH, not PUT: the panel sends the single control that moved.

    Sending the whole style on every slider tick would make two people editing
    the same video overwrite each other's unrelated changes.
    """
    await _require_owned(db, video_id, user.id)
    style = await style_service.get_or_create_style(db, video_id)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return CaptionStyleRead.model_validate(style)

    updated = await style_service.update_style(db, style, changes)
    return CaptionStyleRead.model_validate(updated)


@router.post(
    "/videos/{video_id}/style/preset", response_model=CaptionStyleRead, tags=["styles"]
)
async def apply_preset(
    video_id: int, payload: PresetApply, user: CurrentUser, db: DbSession
) -> CaptionStyleRead:
    await _require_owned(db, video_id, user.id)
    style = await style_service.get_or_create_style(db, video_id)
    updated = await style_service.apply_preset(db, style, payload.name)
    return CaptionStyleRead.model_validate(updated)


@router.delete("/videos/{video_id}/style", response_model=CaptionStyleRead, tags=["styles"])
async def reset_style(
    video_id: int, user: CurrentUser, db: DbSession
) -> CaptionStyleRead:
    """
    Back to the defaults.

    Returns the reset style rather than 204, so the panel can redraw from the
    response instead of firing a second request to find out what it now is.
    """
    await _require_owned(db, video_id, user.id)
    style = await style_service.get_or_create_style(db, video_id)

    updated = await style_service.update_style(
        db, style, style_service.default_style_fields()
    )
    return CaptionStyleRead.model_validate(updated)
