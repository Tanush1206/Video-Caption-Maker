"""The API reports the release it was built as."""

from app.config import Settings, get_settings
from app.main import app


def test_the_api_version_is_the_release_version():
    assert app.version == get_settings().vcm_version
    assert app.openapi()["info"]["version"] == get_settings().vcm_version


def test_the_release_version_comes_from_vcm_version(monkeypatch):
    monkeypatch.setenv("VCM_VERSION", "1.0.5")
    assert Settings().vcm_version == "1.0.5"


def test_a_build_without_a_version_says_dev(monkeypatch):
    monkeypatch.delenv("VCM_VERSION", raising=False)
    assert Settings(_env_file=None).vcm_version == "dev"
