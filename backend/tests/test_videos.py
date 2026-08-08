import hashlib
import json
import subprocess

import pytest

from app.services import media, storage


async def upload(client, headers, content: bytes, filename="clip.mp4", content_type="video/mp4"):
    return await client.post(
        "/api/videos",
        headers=headers,
        files={"file": (filename, content, content_type)},
    )


@pytest.mark.asyncio
async def test_upload_requires_authentication(client, sample_video_bytes):
    response = await upload(client, {}, sample_video_bytes)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_upload_stores_video_and_probes_metadata(
    client, auth_headers, sample_video_bytes
):
    response = await upload(client, auth_headers, sample_video_bytes)

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "clip"
    assert body["original_filename"] == "clip.mp4"
    assert body["size_bytes"] == len(sample_video_bytes)
    assert body["status"] == "pending"
    # The fixture builds a 1-second clip; allow slack for container padding.
    assert 500 <= body["duration_ms"] <= 2000
    assert body["has_thumbnail"] is True


@pytest.mark.asyncio
async def test_response_never_exposes_filesystem_paths(
    client, auth_headers, sample_video_bytes
):
    body = (await upload(client, auth_headers, sample_video_bytes)).json()

    assert "storage_path" not in body
    assert "thumbnail_path" not in body


@pytest.mark.asyncio
async def test_rejects_unsupported_content_type(client, auth_headers):
    response = await upload(
        client, auth_headers, b"not a video", filename="x.mp4", content_type="text/plain"
    )
    assert response.status_code == 415


@pytest.mark.asyncio
async def test_rejects_unsupported_extension(client, auth_headers, sample_video_bytes):
    response = await upload(
        client, auth_headers, sample_video_bytes, filename="clip.exe"
    )
    assert response.status_code == 415


@pytest.mark.asyncio
async def test_rejects_empty_file(client, auth_headers):
    response = await upload(client, auth_headers, b"")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_traversal_filename_cannot_escape_storage(
    client, auth_headers, sample_video_bytes
):
    """The stored name is generated, so a hostile filename is inert."""
    response = await upload(
        client, auth_headers, sample_video_bytes, filename="../../../etc/passwd.mp4"
    )

    assert response.status_code == 201
    # Kept verbatim as a label...
    assert response.json()["original_filename"] == "../../../etc/passwd.mp4"

    # ...but every file actually written stays under the storage root.
    root = storage.storage_root().resolve()
    for path in root.rglob("*"):
        assert path.resolve().is_relative_to(root)


@pytest.mark.asyncio
async def test_list_returns_only_your_own_videos(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    await upload(client, auth_headers, sample_video_bytes)

    mine = (await client.get("/api/videos", headers=auth_headers)).json()
    theirs = (await client.get("/api/videos", headers=second_user_headers)).json()

    assert mine["total"] == 1
    assert theirs["total"] == 0


@pytest.mark.asyncio
async def test_pages_do_not_overlap_or_skip(
    client, auth_headers, sample_video_bytes, db_session
):
    """
    Five videos sharing one timestamp, paged two at a time, must yield five
    distinct ids in a defined order.

    The timestamps are forced equal because real upload times differ by
    milliseconds and never exercise the tie at all. Be clear about what this
    does and does not prove: with ties, `ORDER BY created_at` alone leaves the
    row order *unspecified*, and an unspecified order is free to come out
    right — removing the id tiebreaker does not reliably fail this test,
    because Postgres tends to return a small table in heap order anyway.

    So this pins the contract rather than catching the bug: it asserts the
    total ordering the pager depends on, and it would catch a regression that
    reorders pages consistently. The tiebreaker itself is a correctness
    argument, not something a five-row fixture can demonstrate.
    """
    from datetime import datetime, timezone

    from sqlalchemy import update

    from app.models.video import Video

    for index in range(5):
        assert (
            await upload(client, auth_headers, sample_video_bytes, f"clip{index}.mp4")
        ).status_code == 201

    owner_id = (await client.get("/api/auth/me", headers=auth_headers)).json()["id"]
    await db_session.execute(
        update(Video)
        .where(Video.owner_id == owner_id)
        .values(created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    )
    await db_session.commit()

    seen: list[int] = []
    for offset in (0, 2, 4):
        page = (
            await client.get(f"/api/videos?limit=2&offset={offset}", headers=auth_headers)
        ).json()
        assert page["total"] == 5
        seen.extend(item["id"] for item in page["items"])

    assert len(seen) == 5
    assert len(set(seen)) == 5, f"a page boundary duplicated or dropped a video: {seen}"
    # Newest first; with created_at tied, that leaves the id tiebreaker.
    assert seen == sorted(seen, reverse=True), f"page order is not total: {seen}"


@pytest.mark.asyncio
async def test_total_counts_the_library_not_the_page(
    client, auth_headers, sample_video_bytes
):
    """Without this the client cannot know a second page exists."""
    for index in range(3):
        await upload(client, auth_headers, sample_video_bytes, f"clip{index}.mp4")

    page = (await client.get("/api/videos?limit=1", headers=auth_headers)).json()

    assert len(page["items"]) == 1
    assert page["total"] == 3


@pytest.mark.asyncio
async def test_status_filter_narrows_both_items_and_total(
    client, auth_headers, sample_video_bytes
):
    """
    The count has to use the same predicate as the rows.

    A filtered list with an unfiltered total renders as "1 of 12 videos" over
    a single card, and the pager offers pages that come back empty.
    """
    await upload(client, auth_headers, sample_video_bytes)

    pending = (await client.get("/api/videos?status=pending", headers=auth_headers)).json()
    completed = (
        await client.get("/api/videos?status=completed", headers=auth_headers)
    ).json()

    # Transcription is stubbed out in tests, so the upload stays pending.
    assert pending["total"] == 1
    assert len(pending["items"]) == 1
    assert completed["total"] == 0
    assert completed["items"] == []


@pytest.mark.asyncio
async def test_unknown_status_is_rejected_rather_than_ignored(client, auth_headers):
    """
    Silently ignoring it would return the whole library while the UI shows a
    filter as active — the user reads that as data that shouldn't be there.
    """
    response = await client.get("/api/videos?status=banana", headers=auth_headers)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_filter_cannot_widen_the_scope(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    await upload(client, auth_headers, sample_video_bytes)

    theirs = (
        await client.get("/api/videos?status=pending", headers=second_user_headers)
    ).json()

    assert theirs["total"] == 0


@pytest.mark.asyncio
async def test_another_user_cannot_reach_your_video(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    for method, path in [
        ("get", f"/api/videos/{video_id}"),
        ("get", f"/api/videos/{video_id}/thumbnail"),
        ("get", f"/api/videos/{video_id}/waveform"),
        ("post", f"/api/videos/{video_id}/stream-token"),
        ("delete", f"/api/videos/{video_id}"),
    ]:
        response = await getattr(client, method)(path, headers=second_user_headers)
        # 404 not 403: a 403 would confirm the id exists.
        assert response.status_code == 404, f"{method} {path} returned {response.status_code}"


async def stream_token(client, headers, video_id: int) -> str:
    response = await client.post(f"/api/videos/{video_id}/stream-token", headers=headers)
    assert response.status_code == 200
    return response.json()["token"]


@pytest.mark.asyncio
async def test_stream_requires_a_token(client, auth_headers, sample_video_bytes):
    """A bearer header is not accepted here — the credential must be in the URL."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/stream", headers=auth_headers)

    assert response.status_code == 422  # missing required query parameter


@pytest.mark.asyncio
async def test_stream_rejects_a_garbage_token(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/stream?token=not-a-jwt")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_stream_rejects_an_access_token(client, auth_headers, sample_video_bytes):
    """
    The `type` claim is what stops this. An access token in the query string
    would otherwise be a full API credential sitting in the browser's history.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    access = auth_headers["Authorization"].removeprefix("Bearer ")

    response = await client.get(f"/api/videos/{video_id}/stream?token={access}")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_stream_token_is_bound_to_one_video(
    client, auth_headers, sample_video_bytes
):
    """A leaked URL must not become a key to the rest of the library."""
    first = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    second = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    token = await stream_token(client, auth_headers, first)
    response = await client.get(f"/api/videos/{second}/stream?token={token}")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_stream_serves_the_file_with_a_valid_token(
    client, auth_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    response = await client.get(f"/api/videos/{video_id}/stream?token={token}")

    assert response.status_code == 200
    assert response.content == sample_video_bytes


@pytest.mark.asyncio
async def test_upload_and_stream_are_byte_identical(
    client, auth_headers, sample_video_bytes
):
    """
    Nothing in this application re-encodes video.

    The guard is a checksum rather than a size or duration check, because a
    re-encode can easily preserve both while changing every byte. If a future
    change ever transcodes on upload — for a smaller thumbnail, a "web-safe"
    profile, anything — this fails immediately rather than being discovered as
    "the quality looks worse than my original".
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    served = (await client.get(f"/api/videos/{video_id}/stream?token={token}")).content

    assert hashlib.sha256(served).hexdigest() == hashlib.sha256(sample_video_bytes).hexdigest()


@pytest.mark.asyncio
async def test_stream_preserves_the_audio_track(
    client, auth_headers, sample_video_bytes, tmp_path
):
    """The uploaded fixture has an AAC track; what comes back must still have it."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    served = (await client.get(f"/api/videos/{video_id}/stream?token={token}")).content
    round_tripped = tmp_path / "round_tripped.mp4"
    round_tripped.write_bytes(served)

    streams = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(round_tripped),
        ],
        capture_output=True,
        timeout=60,
    ).stdout.decode()

    assert "audio" in streams, f"audio track lost in transit; streams were: {streams!r}"
    assert "video" in streams


@pytest.mark.asyncio
async def test_stream_names_the_file_for_playback_and_for_download(
    client, auth_headers, sample_video_bytes
):
    """
    Saved files need their extension back.

    Without a filename the browser names a saved video after the last path
    segment — `stream`, with no extension — which Windows won't open. `inline`
    keeps a <video> element playing it; `download=1` is the explicit save.
    """
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    playback = await client.get(f"/api/videos/{video_id}/stream?token={token}")
    attachment = await client.get(
        f"/api/videos/{video_id}/stream?token={token}&download=1"
    )

    assert playback.headers["content-disposition"].startswith("inline")
    assert attachment.headers["content-disposition"].startswith("attachment")
    assert "clip.mp4" in attachment.headers["content-disposition"]


@pytest.mark.asyncio
async def test_stream_supports_range_requests(client, auth_headers, sample_video_bytes):
    """Without 206 support a player must refetch from the start to seek."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    response = await client.get(
        f"/api/videos/{video_id}/stream?token={token}",
        headers={"Range": "bytes=0-99"},
    )

    assert response.status_code == 206
    assert response.headers["content-range"].startswith("bytes 0-99/")
    assert len(response.content) == 100


@pytest.mark.asyncio
async def test_range_request_reads_from_the_middle(
    client, auth_headers, sample_video_bytes
):
    """Seeking is only cheap if the server can start partway into the file."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]
    token = await stream_token(client, auth_headers, video_id)

    response = await client.get(
        f"/api/videos/{video_id}/stream?token={token}",
        headers={"Range": "bytes=500-599"},
    )

    assert response.status_code == 206
    assert response.content == sample_video_bytes[500:600]


@pytest.mark.asyncio
async def test_waveform_returns_peaks_and_caches_them(
    client, auth_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    # The dev database this runs against has real videos in it, some already
    # carrying a cached waveform. Compare before and after rather than counting
    # what happens to be on disk.
    before = set(storage.storage_root().rglob("*.peaks.json"))

    response = await client.get(f"/api/videos/{video_id}/waveform", headers=auth_headers)

    assert response.status_code == 200
    peaks = response.json()["peaks"]
    assert len(peaks) == media.WAVEFORM_BUCKETS
    assert all(0.0 <= peak <= 1.0 for peak in peaks)
    # The fixture is a 440 Hz sine at full scale, so it must not read as silence.
    assert max(peaks) > 0.5

    written = set(storage.storage_root().rglob("*.peaks.json")) - before
    assert len(written) == 1
    assert json.loads(written.pop().read_text()) == peaks


@pytest.mark.asyncio
async def test_waveform_is_empty_for_a_silent_video(
    client, auth_headers, sample_silent_video_bytes
):
    """No audio track is a normal upload, not an error — the timeline copes."""
    video_id = (
        await upload(client, auth_headers, sample_silent_video_bytes)
    ).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/waveform", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["peaks"] == []


@pytest.mark.asyncio
async def test_thumbnail_is_served(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(f"/api/videos/{video_id}/thumbnail", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert len(response.content) > 0


@pytest.mark.asyncio
async def test_rename_video(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.patch(
        f"/api/videos/{video_id}", headers=auth_headers, json={"title": "Renamed"}
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Renamed"


@pytest.mark.asyncio
async def test_delete_removes_row_and_file(client, auth_headers, sample_video_bytes):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    before = len(list(storage.storage_root().rglob("*.mp4")))
    assert (await client.delete(f"/api/videos/{video_id}", headers=auth_headers)).status_code == 204
    after = len(list(storage.storage_root().rglob("*.mp4")))

    assert after == before - 1, "file was left on disk after delete"
    assert (await client.get(f"/api/videos/{video_id}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_missing_video_is_404(client, auth_headers):
    assert (await client.get("/api/videos/999999", headers=auth_headers)).status_code == 404


def test_storage_resolve_rejects_traversal():
    """Defence in depth on the path helper itself."""
    with pytest.raises(ValueError):
        storage.resolve("../../etc/passwd")


def test_storage_paths_are_generated_not_user_supplied():
    _, relative = storage.build_storage_path(7, "../../evil.mp4")

    assert relative.startswith("user_7/")
    assert ".." not in relative
    assert "evil" not in relative  # the name is a UUID, not theirs
