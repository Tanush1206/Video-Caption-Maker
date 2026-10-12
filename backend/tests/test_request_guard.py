"""
A local install accepts requests from itself, not from whatever can reach it.

Six videos were deleted through a running install, at 08:22 UTC on
2026-10-11, by a browser-driven request sequence nobody could account for,
and nothing recorded what sent it. These pin down the two things that
changed: what a local install refuses, and what it writes down.
"""

import json

import pytest

from app.config import get_settings

# What the app's own page sends through the Next proxy at localhost:3001.
FROM_THE_APP = {
    "x-forwarded-host": "localhost:3001",
    "origin": "http://localhost:3001",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (the app)",
}


@pytest.fixture
def local_install(monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_mode", "local")
    monkeypatch.setattr(settings, "storage_local_path", str(tmp_path))
    return tmp_path


async def _a_video(client, sample_video_bytes) -> int:
    response = await client.post(
        "/api/videos",
        headers=FROM_THE_APP,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _audit(storage) -> list[dict]:
    path = storage / "audit.log"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


@pytest.mark.parametrize(
    "headers",
    [
        # DNS rebinding: same-origin to the browser, but addressed to another name.
        {"x-forwarded-host": "rebind.attacker.example:3001",
         "origin": "http://rebind.attacker.example:3001", "sec-fetch-site": "same-origin"},
        # Another website.
        {"x-forwarded-host": "localhost:3001", "origin": "https://attacker.example",
         "sec-fetch-site": "cross-site"},
        # Another app on this machine, on a different port.
        {"x-forwarded-host": "localhost:3001", "origin": "http://localhost:5173",
         "sec-fetch-site": "same-site"},
    ],
    ids=["dns-rebinding", "cross-site", "other-local-app"],
)
async def test_a_delete_from_anywhere_but_the_app_is_refused_and_recorded(
    client, local_install, sample_video_bytes, headers
):
    video_id = await _a_video(client, sample_video_bytes)

    response = await client.delete(f"/api/videos/{video_id}", headers=headers)

    assert response.status_code == 403
    assert (await client.get(f"/api/videos/{video_id}", headers=FROM_THE_APP)).status_code == 200
    refused = [e for e in _audit(local_install) if e["status"] == 403]
    assert refused and refused[-1]["path"] == f"/api/videos/{video_id}"
    assert refused[-1]["origin"] == headers["origin"]


async def test_a_rebound_page_cannot_read_either(client, local_install):
    response = await client.get(
        "/api/videos", headers={"x-forwarded-host": "rebind.attacker.example:3001"}
    )
    assert response.status_code == 403


async def test_the_apps_own_delete_works_and_says_who_sent_it(
    client, local_install, sample_video_bytes
):
    video_id = await _a_video(client, sample_video_bytes)

    response = await client.delete(f"/api/videos/{video_id}", headers=FROM_THE_APP)

    assert response.status_code == 204
    entry = _audit(local_install)[-1]
    assert entry["method"] == "DELETE"
    assert entry["path"] == f"/api/videos/{video_id}"
    assert entry["status"] == 204
    assert entry["user_agent"] == "Mozilla/5.0 (the app)"
    assert entry["origin"] == "http://localhost:3001"
    assert entry["host"] == "localhost:3001"


async def test_a_script_without_browser_headers_still_works(
    client, local_install, sample_video_bytes
):
    """scripts/e2e.py and curl send no Origin or Sec-Fetch-Site."""
    video_id = await _a_video(client, sample_video_bytes)
    assert (await client.delete(f"/api/videos/{video_id}")).status_code == 204


async def test_a_settings_change_is_recorded_without_its_value(
    client, local_install, monkeypatch
):
    from app.services import app_settings

    stored = {}

    async def remember(session, key, value):
        stored[key] = value

    monkeypatch.setattr(app_settings, "set_value", remember)
    secret = "AIzaSy-not-a-real-key-but-treated-as-one"

    response = await client.patch(
        "/api/system/settings", headers=FROM_THE_APP, json={"gemini_api_key": secret}
    )

    assert response.status_code == 200, response.text
    log = (local_install / "audit.log").read_text()
    assert "/api/system/settings" in log
    assert secret not in log


async def test_a_hosted_deployment_is_not_restricted_to_localhost(client, auth_headers):
    """Accounts mode is reached by its real domain; the guard is local-only."""
    response = await client.get(
        "/api/videos", headers={**auth_headers, "x-forwarded-host": "captions.example.com"}
    )
    assert response.status_code == 200
