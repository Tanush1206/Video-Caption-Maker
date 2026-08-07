"""
Central application configuration.

Everything the app needs from the environment is declared here as a typed
field. This gives us:
  - Fail-fast behavior: app won't start with missing/malformed config
  - Autocomplete + type checking wherever settings are used
  - A single source of truth instead of os.environ.get() scattered everywhere
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ──────────────────────────────────────────────
    environment: str = "development"
    cors_origins: str = "http://localhost:3000"

    # ── Database ─────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://vcm:vcm_dev_password@postgres:5432/vcm"

    # ── Redis / Celery ───────────────────────────────────
    redis_url: str = "redis://redis:6379/0"

    # ── ChromaDB ─────────────────────────────────────────
    chromadb_url: str = "http://chromadb:8000"

    # ── Auth ─────────────────────────────────────────────
    jwt_secret_key: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    # Media URLs carry their credential in the query string, which leaks more
    # readily than a header, so this is kept short.
    stream_token_expire_minutes: int = 60
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    # Must exactly match an Authorized redirect URI in the Google Cloud console.
    google_oauth_redirect_uri: str = "http://localhost:8000/api/auth/google/callback"

    # Where to send the browser after an OAuth round-trip completes.
    frontend_url: str = "http://localhost:3000"

    # Name of the httpOnly cookie carrying the refresh token.
    refresh_cookie_name: str = "vcm_refresh"

    # Failed auth attempts allowed per bucket before 429s start.
    auth_rate_limit_attempts: int = 10
    auth_rate_limit_window_seconds: int = 300

    # ── LLM (Gemini) ─────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # ── Whisper ──────────────────────────────────────────
    whisper_model_size: str = "medium"
    whisper_device: str = "cuda"
    whisper_compute_type: str = "float16"
    # Whisper hallucinates text over music and silence; VAD trims those first.
    whisper_vad_filter: bool = True
    # None lets Whisper detect the language per file.
    whisper_language: str | None = None

    # ── Embeddings / vector search ───────────────────────
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    chroma_collection: str = "captions"

    # ── Storage ──────────────────────────────────────────
    storage_backend: str = "local"
    storage_local_path: str = "/app/storage"
    max_upload_size_mb: int = 2048

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance — env is only parsed once per process."""
    return Settings()
