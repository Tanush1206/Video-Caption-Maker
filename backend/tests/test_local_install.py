"""
A local install: hardware tiers, no login, and the settings a user can change.
"""

import json

import pytest

from app.config import get_settings
from app.services import app_settings, hardware


def a_machine(**overrides) -> hardware.Hardware:
    fields = dict(cuda=False, gpu_name=None, vram_gb=None, ram_gb=16.0, cpu_count=8)
    return hardware.Hardware(**{**fields, **overrides})


@pytest.fixture
def auto_env(monkeypatch):
    """Clear any WHISPER_* pinned by the developer's own .env."""
    settings = get_settings()
    monkeypatch.setattr(settings, "whisper_model_size", "auto")
    monkeypatch.setattr(settings, "whisper_device", "auto")
    monkeypatch.setattr(settings, "whisper_compute_type", "auto")
    monkeypatch.setattr(settings, "translation_model", "auto")


# ── Hardware tiers ─────────────────────────────────────────────────────────


def test_a_big_gpu_gets_large_v3_in_float16(auto_env):
    profile = hardware.whisper_profile(a_machine(cuda=True, gpu_name="RTX", vram_gb=16.0))
    assert (profile.model, profile.device, profile.compute_type) == ("large-v3", "cuda", "float16")
    assert profile.source == "auto"


def test_a_small_gpu_drops_to_small(auto_env):
    profile = hardware.whisper_profile(a_machine(cuda=True, vram_gb=4.0))
    assert (profile.model, profile.device) == ("small", "cuda")


def test_cpu_with_plenty_of_ram_gets_turbo_int8(auto_env):
    profile = hardware.whisper_profile(a_machine(ram_gb=16.0))
    assert (profile.model, profile.device, profile.compute_type) == (
        "large-v3-turbo", "cpu", "int8",
    )


def test_cpu_with_little_ram_gets_small_int8(auto_env):
    profile = hardware.whisper_profile(a_machine(ram_gb=7.6))
    assert (profile.model, profile.device, profile.compute_type) == ("small", "cpu", "int8")


def test_the_users_choice_beats_the_tier(auto_env):
    profile = hardware.whisper_profile(a_machine(ram_gb=7.6), "medium")
    assert profile.model == "medium"
    assert profile.source == "user"


def test_a_gpu_env_file_does_not_break_a_cpu_machine(auto_env, monkeypatch):
    """WHISPER_DEVICE=cuda / float16 copied onto a laptop must still run."""
    monkeypatch.setattr(get_settings(), "whisper_device", "cuda")
    monkeypatch.setattr(get_settings(), "whisper_compute_type", "float16")
    profile = hardware.whisper_profile(a_machine())
    assert (profile.device, profile.compute_type) == ("cpu", "int8")


def test_translator_follows_ram(auto_env):
    assert hardware.translator_profile(a_machine(ram_gb=32)).model == "m2m100_1.2B"
    assert hardware.translator_profile(a_machine(ram_gb=8)).model == "m2m100_418M"
    assert hardware.translator_profile(a_machine(cuda=True)).device == "cuda"


# ── Local mode: no login ───────────────────────────────────────────────────


@pytest.fixture
def local_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_mode", "local")


@pytest.mark.asyncio
async def test_local_mode_needs_no_credentials(client, local_mode):
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json()["email"] == "local-user@localhost.localdomain"


@pytest.mark.asyncio
async def test_local_mode_hands_out_a_session_without_a_cookie(client, local_mode):
    """The frontend's bootstrap refresh is what makes the login screen never appear."""
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 200
    assert response.json()["access_token"]


@pytest.mark.asyncio
async def test_accounts_mode_still_requires_a_login(client):
    assert (await client.get("/api/auth/me")).status_code == 401


# ── Settings ───────────────────────────────────────────────────────────────


@pytest.fixture
async def preserved_settings(db_session):
    """Put the install's real settings back after a test changes them."""
    before = await app_settings.get_all(db_session)
    yield
    for key in (app_settings.GEMINI_API_KEY, app_settings.WHISPER_MODEL, app_settings.WORKER_HARDWARE):
        await app_settings.set_value(db_session, key, before.get(key))


@pytest.mark.asyncio
async def test_the_gemini_key_is_stored_but_never_returned(
    client, local_mode, preserved_settings, monkeypatch
):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")

    response = await client.patch(
        "/api/system/settings", json={"gemini_api_key": "AIza-not-a-real-key"}
    )
    assert response.status_code == 200
    assert response.json()["gemini_configured"] is True
    assert response.json()["translation_engine"] == "gemini"
    assert "AIza-not-a-real-key" not in response.text

    cleared = await client.patch("/api/system/settings", json={"gemini_api_key": ""})
    assert cleared.json()["gemini_configured"] is False
    assert cleared.json()["translation_engine"] == "local"


@pytest.mark.asyncio
async def test_whisper_choice_is_validated_and_reported(
    client, local_mode, preserved_settings, db_session
):
    bad = await client.patch("/api/system/settings", json={"whisper_model": "enormous"})
    assert bad.status_code == 422

    await app_settings.set_value(
        db_session,
        app_settings.WORKER_HARDWARE,
        json.dumps(a_machine(ram_gb=8.0).as_dict()),
    )
    body = (await client.patch("/api/system/settings", json={"whisper_model": "medium"})).json()
    assert body["whisper_choice"] == "medium"
    assert body["whisper"]["model"] == "medium"
    assert body["whisper"]["source"] == "user"

    body = (await client.patch("/api/system/settings", json={"whisper_model": "auto"})).json()
    assert body["whisper_choice"] == "auto"


@pytest.mark.asyncio
async def test_install_settings_are_read_only_on_a_hosted_deployment(client, auth_headers):
    response = await client.patch(
        "/api/system/settings", headers=auth_headers, json={"whisper_model": "small"}
    )
    assert response.status_code == 403


# ── Upload with a language ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_carries_the_caption_language(client, auth_headers, sample_video_bytes):
    response = await client.post(
        "/api/videos",
        headers=auth_headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        data={"caption_language": "de"},
    )
    assert response.status_code == 201
    assert response.json()["caption_language"] == "de"


@pytest.mark.asyncio
async def test_upload_rejects_an_unknown_language(client, auth_headers, sample_video_bytes):
    response = await client.post(
        "/api/videos",
        headers=auth_headers,
        files={"file": ("clip.mp4", sample_video_bytes, "video/mp4")},
        data={"caption_language": "klingon"},
    )
    assert response.status_code == 422


# ── Errors a user can act on ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_full_disk_is_reported_as_such(tmp_path, monkeypatch):
    import errno
    from pathlib import Path

    from fastapi import HTTPException

    from app.api import videos

    class Upload:
        async def read(self, _size):
            return b"x"

    def full(*_a, **_k):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(Path, "open", full)
    with pytest.raises(HTTPException) as raised:
        await videos._stream_to_disk(Upload(), tmp_path / "v.mp4")
    assert raised.value.status_code == 507
    assert "disk is full" in raised.value.detail


def test_tls_interception_gets_its_own_instructions(monkeypatch):
    """A Norton/proxy certificate failure is not 'check your internet connection'."""
    import ssl

    from app.services import model_store

    monkeypatch.setattr(model_store, "cached_path", lambda *a: None)

    class Api:
        def model_info(self, *a, **k):
            try:
                raise ssl.SSLCertVerificationError("certificate verify failed: unable to get local issuer")
            except ssl.SSLError as inner:
                raise ConnectionError("ConnectError") from inner

    monkeypatch.setattr("huggingface_hub.HfApi", Api)
    with pytest.raises(model_store.ModelDownloadError) as raised:
        model_store.ensure("org/model", allow_patterns=["model.bin"])
    assert "certs folder" in str(raised.value)
