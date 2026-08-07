"""Caption editing routes."""

import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies import CurrentUser, DbSession
from app.schemas.caption import (
    CaptionPair,
    CaptionRead,
    CaptionSplit,
    CaptionUpdate,
)
from app.services import caption as caption_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _reindex(video_id: int, caption_ids: list[int]) -> None:
    """
    Queue re-embedding for edited captions.

    Search runs on embeddings of the caption text, so an edit that isn't
    re-embedded leaves search matching words the transcript no longer
    contains. Queued rather than done inline: the API process must not load
    the embedding model, and the user shouldn't wait on it to save a typo.
    """
    try:
        from app.workers.transcription import reindex_captions

        reindex_captions.delay(video_id, caption_ids)
    except Exception as exc:  # noqa: BLE001
        # Search drifting slightly is not worth failing the edit over.
        logger.error("Could not queue reindex for video %s: %s", video_id, exc)


async def _require_caption(db, caption_id: int, user_id: int):
    caption = await caption_service.get_owned_caption(db, caption_id, user_id)
    if caption is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Caption not found")
    return caption


@router.patch("/{caption_id}", response_model=CaptionRead)
async def update_caption(
    caption_id: int, payload: CaptionUpdate, user: CurrentUser, db: DbSession
) -> CaptionRead:
    caption = await _require_caption(db, caption_id, user.id)

    # exclude_unset, so `"override_bold": null` clears the override while
    # omitting the key leaves it untouched. Those mean different things, and
    # `None` alone cannot express both.
    changes = payload.model_dump(exclude_unset=True)

    # Only the override_* columns are nullable. An explicit null for the
    # others is meaningless, and letting it through would fail at the database
    # with a NOT NULL violation instead of being ignored here.
    for field in ("text", "start_ms", "end_ms"):
        if changes.get(field, ...) is None:
            del changes[field]

    if not changes:
        return CaptionRead.model_validate(caption)

    # A one-sided timing edit can only be validated against what's stored.
    start = changes.get("start_ms", caption.start_ms)
    end = changes.get("end_ms", caption.end_ms)
    if start >= end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start_ms must be less than end_ms",
        )

    updated = await caption_service.update_caption(db, caption, changes)

    # Only the words affect the embedding. Retiming or restyling a caption
    # leaves the vector correct, so re-embedding would be pure waste.
    if "text" in changes:
        _reindex(updated.video_id, [updated.id])

    return CaptionRead.model_validate(updated)


@router.post("/{caption_id}/split", response_model=CaptionPair)
async def split_caption(
    caption_id: int, payload: CaptionSplit, user: CurrentUser, db: DbSession
) -> CaptionPair:
    caption = await _require_caption(db, caption_id, user.id)

    try:
        first, second = await caption_service.split_caption(
            db, caption, at_ms=payload.at_ms, text_offset=payload.text_offset
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    _reindex(first.video_id, [first.id, second.id])

    return CaptionPair(
        first=CaptionRead.model_validate(first),
        second=CaptionRead.model_validate(second),
    )


@router.post("/{caption_id}/merge-next", response_model=CaptionRead)
async def merge_next(caption_id: int, user: CurrentUser, db: DbSession) -> CaptionRead:
    caption = await _require_caption(db, caption_id, user.id)

    merged = await caption_service.merge_with_next(db, caption)
    if merged is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This is the last caption; there is nothing to merge with",
        )

    _reindex(merged.video_id, [merged.id])

    return CaptionRead.model_validate(merged)


@router.delete("/{caption_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_caption(caption_id: int, user: CurrentUser, db: DbSession) -> None:
    caption = await _require_caption(db, caption_id, user.id)
    video_id = caption.video_id

    await caption_service.delete_caption(db, caption)

    # Removing the row leaves its vector behind; drop it or search keeps
    # returning text that is no longer in the transcript.
    _reindex(video_id, [])
