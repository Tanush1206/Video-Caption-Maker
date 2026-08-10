"""Dashboard aggregates."""

import pytest


async def _upload(client, headers, video_bytes, name="clip.mp4"):
    response = await client.post(
        "/api/videos",
        headers=headers,
        files={"file": (name, video_bytes, "video/mp4")},
    )
    assert response.status_code == 201
    return response.json()


async def test_stats_require_authentication(client):
    assert (await client.get("/api/stats")).status_code == 401


async def test_empty_library_reports_zeroes_not_nulls(client, auth_headers):
    """
    A fresh account has no rows to aggregate, and SUM over no rows is NULL in
    SQL. Without the COALESCE this endpoint would return null for storage and
    duration, and the dashboard would render "null bytes".
    """
    body = (await client.get("/api/stats", headers=auth_headers)).json()

    assert body["videos"] == 0
    assert body["storage_bytes"] == 0
    assert body["duration_ms"] == 0
    assert body["captions"] == 0
    assert body["exports"] == 0


async def test_every_status_is_present_even_at_zero(client, auth_headers):
    """The client should never have to decide what a missing key means."""
    body = (await client.get("/api/stats", headers=auth_headers)).json()

    assert set(body["by_status"]) == {"pending", "processing", "completed", "failed"}
    assert all(count == 0 for count in body["by_status"].values())


async def test_counts_and_totals_follow_the_library(
    client, auth_headers, sample_video_bytes
):
    before = (await client.get("/api/stats", headers=auth_headers)).json()

    first = await _upload(client, auth_headers, sample_video_bytes, "one.mp4")
    second = await _upload(client, auth_headers, sample_video_bytes, "two.mp4")

    after = (await client.get("/api/stats", headers=auth_headers)).json()

    assert after["videos"] == before["videos"] + 2
    assert after["storage_bytes"] == first["size_bytes"] + second["size_bytes"]
    # Both uploads probed a real duration, so the total is their sum.
    assert after["duration_ms"] == first["duration_ms"] + second["duration_ms"]


async def test_deleting_a_video_takes_its_bytes_with_it(
    client, auth_headers, sample_video_bytes
):
    video = await _upload(client, auth_headers, sample_video_bytes)
    assert (await client.get("/api/stats", headers=auth_headers)).json()["videos"] == 1

    await client.delete(f"/api/videos/{video['id']}", headers=auth_headers)

    after = (await client.get("/api/stats", headers=auth_headers)).json()
    assert after["videos"] == 0
    assert after["storage_bytes"] == 0


async def test_stats_are_scoped_to_the_caller(
    client, auth_headers, second_user_headers, sample_video_bytes
):
    """
    The interesting failure here is not a leak of content but a leak of
    volume: a stats route that aggregated the whole table would tell any
    signed-in user how much data everyone else has.
    """
    await _upload(client, auth_headers, sample_video_bytes)

    mine = (await client.get("/api/stats", headers=auth_headers)).json()
    theirs = (await client.get("/api/stats", headers=second_user_headers)).json()

    assert mine["videos"] == 1
    assert theirs["videos"] == 0
    assert theirs["storage_bytes"] == 0


async def test_captions_are_counted_across_videos(
    client, auth_headers, sample_video_bytes, db_session
):
    from app.models.caption import Caption

    video = await _upload(client, auth_headers, sample_video_bytes)

    for index in range(3):
        db_session.add(
            Caption(
                video_id=video["id"],
                sequence=index,
                start_ms=index * 1000,
                end_ms=index * 1000 + 900,
                text=f"line {index}",
            )
        )
    await db_session.commit()

    body = (await client.get("/api/stats", headers=auth_headers)).json()
    assert body["captions"] == 3


async def test_exports_are_counted(client, auth_headers, sample_video_bytes, db_session):
    from app.models.caption import Caption

    video = await _upload(client, auth_headers, sample_video_bytes)
    db_session.add(
        Caption(video_id=video["id"], sequence=0, start_ms=0, end_ms=500, text="hello")
    )
    await db_session.commit()

    created = await client.post(
        f"/api/videos/{video['id']}/exports", headers=auth_headers, json={"format": "srt"}
    )
    assert created.status_code == 201

    body = (await client.get("/api/stats", headers=auth_headers)).json()
    assert body["exports"] == 1


async def test_storage_bytes_is_an_integer_not_a_decimal(
    client, auth_headers, sample_video_bytes
):
    """
    SUM over a BIGINT column returns NUMERIC in Postgres, which arrives as a
    Decimal. Serialised without the int() cast it becomes a JSON float, and a
    library measured in gigabytes starts reporting fractional bytes.
    """
    await _upload(client, auth_headers, sample_video_bytes)

    raw = (await client.get("/api/stats", headers=auth_headers)).text
    body = (await client.get("/api/stats", headers=auth_headers)).json()

    assert isinstance(body["storage_bytes"], int)
    assert f'"storage_bytes":{body["storage_bytes"]}' in raw.replace(" ", "")


@pytest.mark.parametrize(
    "field", ["videos", "captions", "exports", "disk_free_bytes", "disk_total_bytes"]
)
async def test_numeric_fields_are_never_negative(client, auth_headers, field):
    body = (await client.get("/api/stats", headers=auth_headers)).json()
    assert body[field] >= 0


async def test_disk_total_is_at_least_disk_free(client, auth_headers):
    """
    The dashboard divides one by the other to draw a fill bar. If free ever
    exceeded total the bar would render past 100% and overflow its track.
    """
    body = (await client.get("/api/stats", headers=auth_headers)).json()
    assert body["disk_total_bytes"] >= body["disk_free_bytes"] > 0
