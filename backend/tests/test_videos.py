import pytest

from app.services import storage


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
async def test_another_user_cannot_reach_your_video(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    for method, path in [
        ("get", f"/api/videos/{video_id}"),
        ("get", f"/api/videos/{video_id}/stream"),
        ("get", f"/api/videos/{video_id}/thumbnail"),
        ("delete", f"/api/videos/{video_id}"),
    ]:
        response = await getattr(client, method)(path, headers=second_user_headers)
        # 404 not 403: a 403 would confirm the id exists.
        assert response.status_code == 404, f"{method} {path} returned {response.status_code}"


@pytest.mark.asyncio
async def test_stream_supports_range_requests(client, auth_headers, sample_video_bytes):
    """Without 206 support a player must refetch from the start to seek."""
    video_id = (await upload(client, auth_headers, sample_video_bytes)).json()["id"]

    response = await client.get(
        f"/api/videos/{video_id}/stream",
        headers={**auth_headers, "Range": "bytes=0-99"},
    )

    assert response.status_code == 206
    assert response.headers["content-range"].startswith("bytes 0-99/")
    assert len(response.content) == 100


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
