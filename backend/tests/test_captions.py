"""Caption editing: text, timing, split, merge, delete, and ownership."""

import pytest
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.caption import Caption


async def make_video(client, headers, sample_video_bytes) -> int:
    response = await client.post(
        "/api/videos", headers=headers, files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")}
    )
    return response.json()["id"]


async def seed_captions(video_id: int, count: int = 3) -> list[int]:
    """Three consecutive 2-second captions."""
    async with AsyncSessionLocal() as session:
        rows = [
            Caption(
                video_id=video_id,
                sequence=i,
                start_ms=i * 2000,
                end_ms=(i + 1) * 2000,
                text=f"caption number {i}",
                confidence=-0.5 - i / 10,
            )
            for i in range(count)
        ]
        session.add_all(rows)
        await session.commit()
        return [row.id for row in rows]


async def sequences(video_id: int) -> list[tuple[int, str]]:
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(Caption).where(Caption.video_id == video_id).order_by(Caption.sequence)
            )
        ).scalars().all()
        return [(row.sequence, row.text) for row in rows]


@pytest.fixture
async def video_with_captions(client, auth_headers, sample_video_bytes):
    video_id = await make_video(client, auth_headers, sample_video_bytes)
    caption_ids = await seed_captions(video_id)
    return video_id, caption_ids


# ── Editing text and timing ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_edit_text_persists(client, auth_headers, video_with_captions):
    _, caption_ids = video_with_captions

    response = await client.patch(
        f"/api/captions/{caption_ids[0]}", headers=auth_headers, json={"text": "corrected"}
    )

    assert response.status_code == 200
    assert response.json()["text"] == "corrected"

    async with AsyncSessionLocal() as session:
        assert (await session.get(Caption, caption_ids[0])).text == "corrected"


@pytest.mark.asyncio
async def test_edit_timing(client, auth_headers, video_with_captions):
    _, caption_ids = video_with_captions

    response = await client.patch(
        f"/api/captions/{caption_ids[0]}",
        headers=auth_headers,
        json={"start_ms": 100, "end_ms": 1900},
    )

    assert response.status_code == 200
    assert (response.json()["start_ms"], response.json()["end_ms"]) == (100, 1900)


@pytest.mark.asyncio
async def test_reversed_timing_is_rejected(client, auth_headers, video_with_captions):
    _, caption_ids = video_with_captions

    response = await client.patch(
        f"/api/captions/{caption_ids[0]}",
        headers=auth_headers,
        json={"start_ms": 5000, "end_ms": 1000},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_one_sided_timing_edit_is_validated_against_stored_value(
    client, auth_headers, video_with_captions
):
    """Caption 0 is 0-2000ms. Moving only start past the stored end must fail."""
    _, caption_ids = video_with_captions

    response = await client.patch(
        f"/api/captions/{caption_ids[0]}", headers=auth_headers, json={"start_ms": 9000}
    )
    assert response.status_code == 422


# ── Split ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_split_creates_two_captions_and_renumbers(
    client, auth_headers, video_with_captions
):
    video_id, caption_ids = video_with_captions

    response = await client.post(
        f"/api/captions/{caption_ids[0]}/split", headers=auth_headers, json={"at_ms": 1000}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["first"]["end_ms"] == 1000
    assert body["second"]["start_ms"] == 1000
    assert body["second"]["end_ms"] == 2000

    # Sequences stay gapless and in order, with the later captions shifted.
    assert [seq for seq, _ in await sequences(video_id)] == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_split_divides_the_text(client, auth_headers, video_with_captions):
    _, caption_ids = video_with_captions

    body = (
        await client.post(
            f"/api/captions/{caption_ids[0]}/split",
            headers=auth_headers,
            json={"at_ms": 1000, "text_offset": 7},
        )
    ).json()

    assert body["first"]["text"] == "caption"
    assert body["second"]["text"] == "number 0"


@pytest.mark.asyncio
async def test_split_does_not_cut_a_word_in_half(client, auth_headers, video_with_captions):
    """Without an offset the split is time-proportional, snapped to a space."""
    _, caption_ids = video_with_captions

    body = (
        await client.post(
            f"/api/captions/{caption_ids[0]}/split", headers=auth_headers, json={"at_ms": 1000}
        )
    ).json()

    combined = f"{body['first']['text']} {body['second']['text']}"
    assert combined.split() == "caption number 0".split()


@pytest.mark.asyncio
async def test_split_outside_the_caption_is_rejected(
    client, auth_headers, video_with_captions
):
    _, caption_ids = video_with_captions

    # Caption 0 spans 0-2000ms.
    response = await client.post(
        f"/api/captions/{caption_ids[0]}/split", headers=auth_headers, json={"at_ms": 9000}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_split_at_the_very_edge_is_rejected(client, auth_headers, video_with_captions):
    """A zero-length caption is never what someone wanted."""
    _, caption_ids = video_with_captions

    response = await client.post(
        f"/api/captions/{caption_ids[0]}/split", headers=auth_headers, json={"at_ms": 0}
    )
    assert response.status_code == 422


# ── Merge ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_merge_joins_text_and_extends_timing(
    client, auth_headers, video_with_captions
):
    video_id, caption_ids = video_with_captions

    response = await client.post(
        f"/api/captions/{caption_ids[0]}/merge-next", headers=auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "caption number 0 caption number 1"
    assert body["end_ms"] == 4000  # absorbed the next caption's end

    # One fewer caption, still gapless.
    assert [seq for seq, _ in await sequences(video_id)] == [0, 1]


@pytest.mark.asyncio
async def test_merge_keeps_the_lower_confidence(client, auth_headers, video_with_captions):
    """The merged line is only as trustworthy as its weakest part."""
    _, caption_ids = video_with_captions

    body = (
        await client.post(f"/api/captions/{caption_ids[0]}/merge-next", headers=auth_headers)
    ).json()

    assert body["confidence"] == pytest.approx(-0.6)


@pytest.mark.asyncio
async def test_merging_the_last_caption_is_rejected(
    client, auth_headers, video_with_captions
):
    _, caption_ids = video_with_captions

    response = await client.post(
        f"/api/captions/{caption_ids[-1]}/merge-next", headers=auth_headers
    )
    assert response.status_code == 422


# ── Delete ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_closes_the_sequence_gap(client, auth_headers, video_with_captions):
    video_id, caption_ids = video_with_captions

    response = await client.delete(f"/api/captions/{caption_ids[1]}", headers=auth_headers)

    assert response.status_code == 204
    rows = await sequences(video_id)
    assert [seq for seq, _ in rows] == [0, 1]
    assert [text for _, text in rows] == ["caption number 0", "caption number 2"]


# ── Ownership ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_another_user_cannot_edit_your_captions(
    client, auth_headers, second_user_headers, video_with_captions
):
    _, caption_ids = video_with_captions
    caption_id = caption_ids[0]

    for method, path, kwargs in [
        ("patch", f"/api/captions/{caption_id}", {"json": {"text": "hacked"}}),
        ("post", f"/api/captions/{caption_id}/split", {"json": {"at_ms": 1000}}),
        ("post", f"/api/captions/{caption_id}/merge-next", {}),
        ("delete", f"/api/captions/{caption_id}", {}),
    ]:
        response = await getattr(client, method)(
            path, headers=second_user_headers, **kwargs
        )
        assert response.status_code == 404, f"{method} {path} → {response.status_code}"

    # And nothing was actually changed.
    async with AsyncSessionLocal() as session:
        assert (await session.get(Caption, caption_id)).text == "caption number 0"


@pytest.mark.asyncio
async def test_editing_requires_authentication(client, video_with_captions):
    _, caption_ids = video_with_captions

    response = await client.patch(f"/api/captions/{caption_ids[0]}", json={"text": "x"})
    assert response.status_code == 401
