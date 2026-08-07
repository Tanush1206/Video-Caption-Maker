"""
Caption editing.

Every lookup joins through to the owning video, so a caption belonging to
someone else is simply not found. Editing operates on rows the user provably
owns without any call site needing to remember a check.
"""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption import Caption
from app.models.video import Video

# Minimum length of a caption after a split. Whisper timings are approximate,
# so a zero- or one-millisecond caption is never something a user wanted.
MIN_CAPTION_MS = 10


async def get_owned_caption(
    db: AsyncSession, caption_id: int, owner_id: int
) -> Caption | None:
    result = await db.execute(
        select(Caption)
        .join(Video, Caption.video_id == Video.id)
        .where(Caption.id == caption_id, Video.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def get_neighbour(db: AsyncSession, caption: Caption, offset: int) -> Caption | None:
    """The caption `offset` positions away in the same video."""
    result = await db.execute(
        select(Caption).where(
            Caption.video_id == caption.video_id,
            Caption.sequence == caption.sequence + offset,
        )
    )
    return result.scalar_one_or_none()


async def update_caption(db: AsyncSession, caption: Caption, changes: dict) -> Caption:
    """
    Apply an already-validated set of field changes.

    A dict rather than keyword arguments defaulting to None, because the
    emphasis overrides need `null` to mean "clear this and go back to
    inheriting the video's style". With `text: str | None = None` there is no
    way to say that — None is indistinguishable from "not supplied". The route
    builds this dict with `exclude_unset`, which keeps the two meanings apart.
    """
    for field, value in changes.items():
        setattr(caption, field, value)

    await db.commit()
    await db.refresh(caption)
    return caption


async def _shift_sequences_from(
    db: AsyncSession, video_id: int, from_sequence: int, by: int
) -> None:
    """
    Move every caption at or after `from_sequence` by `by` positions.

    Done as a single UPDATE rather than loading rows and saving them back:
    a long transcript would otherwise mean thousands of round-trips per split.
    """
    await db.execute(
        update(Caption)
        .where(Caption.video_id == video_id, Caption.sequence >= from_sequence)
        .values(sequence=Caption.sequence + by)
    )


async def split_caption(
    db: AsyncSession, caption: Caption, *, at_ms: int, text_offset: int | None = None
) -> tuple[Caption, Caption]:
    """
    Split one caption into two at `at_ms`.

    Returns (first, second). `text_offset` is where to divide the words; when
    omitted the split is proportional to the time, which is the best guess
    available without word-level timings.
    """
    if not (caption.start_ms + MIN_CAPTION_MS <= at_ms <= caption.end_ms - MIN_CAPTION_MS):
        raise ValueError("Split point must fall inside the caption")

    if text_offset is None:
        span = caption.end_ms - caption.start_ms
        ratio = (at_ms - caption.start_ms) / span if span else 0.5
        text_offset = _nearest_word_boundary(caption.text, round(len(caption.text) * ratio))

    text_offset = max(0, min(text_offset, len(caption.text)))
    first_text = caption.text[:text_offset].strip()
    second_text = caption.text[text_offset:].strip()

    original_end = caption.end_ms

    # Make room for the new row before inserting it, so sequence stays unique
    # and gapless.
    await _shift_sequences_from(db, caption.video_id, caption.sequence + 1, 1)

    caption.end_ms = at_ms
    caption.text = first_text

    second = Caption(
        video_id=caption.video_id,
        sequence=caption.sequence + 1,
        start_ms=at_ms,
        end_ms=original_end,
        text=second_text,
        confidence=caption.confidence,
    )
    db.add(second)

    await db.commit()
    await db.refresh(caption)
    await db.refresh(second)
    return caption, second


def _nearest_word_boundary(text: str, index: int) -> int:
    """
    Nudge a split point to the closest space, so words aren't cut in half.

    Falls back to the raw index when the text has no spaces near it.
    """
    if not text or index <= 0 or index >= len(text):
        return index

    left = text.rfind(" ", 0, index)
    right = text.find(" ", index)

    if left == -1 and right == -1:
        return index
    if left == -1:
        return right
    if right == -1:
        return left

    return left if (index - left) <= (right - index) else right


async def merge_with_next(db: AsyncSession, caption: Caption) -> Caption | None:
    """
    Absorb the following caption into this one.

    Returns the merged caption, or None when there is no next caption.
    """
    following = await get_neighbour(db, caption, 1)
    if following is None:
        return None

    caption.text = f"{caption.text.strip()} {following.text.strip()}".strip()
    caption.end_ms = following.end_ms
    # Keep the lower confidence: the merged line is only as trustworthy as its
    # weakest part.
    if following.confidence is not None:
        caption.confidence = (
            following.confidence
            if caption.confidence is None
            else min(caption.confidence, following.confidence)
        )

    await db.delete(following)
    await db.flush()

    # Close the gap the deletion left.
    await _shift_sequences_from(db, caption.video_id, following.sequence + 1, -1)

    await db.commit()
    await db.refresh(caption)
    return caption


async def delete_caption(db: AsyncSession, caption: Caption) -> None:
    video_id, sequence = caption.video_id, caption.sequence

    await db.delete(caption)
    await db.flush()
    await _shift_sequences_from(db, video_id, sequence + 1, -1)
    await db.commit()
