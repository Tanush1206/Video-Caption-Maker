"""The settings the app declares are the ones it reads."""

from app.config import Settings


def test_unused_settings_are_gone():
    # Declared once for an S3 backend and a model cache dir that never existed;
    # nothing read them. HF_HOME decides where models go.
    for name in ("storage_backend", "model_cache_dir", "s3_bucket", "s3_region"):
        assert name not in Settings.model_fields, name


def test_a_stale_env_entry_for_a_removed_setting_is_ignored(monkeypatch):
    # An existing dev .env may still list them; that must not break startup.
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("S3_BUCKET", "anything")
    assert not hasattr(Settings(), "storage_backend")


def test_the_upload_limit_defaults_to_what_installs_enforce():
    # docker-compose.prod.yml: MAX_UPLOAD_SIZE_MB: ${MAX_UPLOAD_SIZE_MB:-4096}
    assert Settings.model_fields["max_upload_size_mb"].default == 4096
