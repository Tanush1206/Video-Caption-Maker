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
    # Download links are shorter-lived than stream tokens: a media URL has to
    # survive a whole editing session, a download only the click that starts it.
    download_token_expire_minutes: int = 15
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
    # An alias, not a pinned version, and deliberately so. Every pinned model
    # tried on this project's free tier reports `limit: 0` — gemini-2.0-flash
    # and -flash-lite return 429 RESOURCE_EXHAUSTED on the very first request,
    # and gemini-2.5-flash 404s. Free-tier quota is granted per model, so a
    # pin is a bet that *that* model keeps a free allowance. The alias follows
    # whichever current flash model does, and today resolves to
    # gemini-3.6-flash.
    #
    # Worth knowing when this next returns 429: the failure is quota, not
    # auth. A bad key gives 401/403 — a 429 means the key is fine and the
    # model is the thing to change.
    gemini_model: str = "gemini-flash-latest"

    # ── Whisper ──────────────────────────────────────────
    # large-v3, not medium, and the gap is not subtle. On a Hindi track with
    # music under the vocal, transcribing the same file:
    #
    #                segments  covered  avg logprob  script-mixed  stray latin
    #     medium        29       86s      -0.760          5            33
    #     large-v3      47      128s      -0.151          0             0
    #
    # `medium` missed the first 46 seconds outright and injected literal
    # Spanish and Russian words into Devanagari — "palabra", "aquela",
    # "Solomon" — which is what a model does when it is guessing. large-v3
    # costs 17% more time (90s -> 106s on a 3-minute file) and about 1.6GB more
    # VRAM, against 12GB free on the card this was measured on.
    #
    # This is also the answer to "can we train it more": no amount of
    # fine-tuning available here would close a gap the next size up closes for
    # free, on a model nobody has to label data for.
    whisper_model_size: str = "large-v3"
    whisper_device: str = "cuda"
    whisper_compute_type: str = "float16"
    # Off, and that is not the obvious choice — VAD was switched on precisely
    # because Whisper hallucinates text over music and silence.
    #
    # The problem is that Silero VAD answers "is this confidently speech?", and
    # gets sung vocals wrong. Measured on two spans of one music video, at
    # -10dB, plainly audible throughout:
    #
    #               VAD default   VAD tuned to 0.1   VAD off
    #   0:60-3:00     7.8s/120        67.4s/120      86.0s/120
    #   3:20-5:00      2.0s/100        2.0s/100      70.0s/100
    #
    # No threshold fixes both spans — the second is barely better at 0.1 than
    # at the default. So VAD comes out, and the hallucination it was guarding
    # against is caught afterwards instead, by measuring the waveform with
    # `silencedetect` and dropping captions that land in actual silence. That
    # asks "is there any sound here at all", which has an unambiguous answer,
    # rather than "is this speech", which does not.
    whisper_vad_filter: bool = False
    # 0.1, not Silero's 0.5. The default asks "is this confidently speech?",
    # which discards sung vocals and anything with music under it: on a real
    # music video it kept 7.8 seconds out of 120 and the video came out with a
    # single caption. This keeps 67.4s of the same span and still hallucinates
    # nothing over silence.
    whisper_vad_threshold: float = 0.1
    # Padding around each chunk, so a quiet first syllable survives.
    whisper_vad_speech_pad_ms: int = 400
    # How much quiet ends a chunk; longer than the default so a breath between
    # lines does not split one sentence in half.
    whisper_vad_min_silence_ms: int = 1000
    # None lets Whisper detect the language per file.
    whisper_language: str | None = None

    # ── Embeddings / vector search ───────────────────────
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    chroma_collection: str = "captions"

    # ── Storage ──────────────────────────────────────────
    storage_backend: str = "local"
    storage_local_path: str = "/app/storage"
    max_upload_size_mb: int = 2048

    # Where Google Fonts downloaded on demand are kept. A shared volume rather
    # than a per-container directory: the backend writes it, the worker reads
    # it, and libass must load the *same file* the browser was served or the
    # preview stops predicting the export.
    #
    # Under /usr/share/fonts so fontconfig finds it without extra config,
    # matching the vendored faces alongside it.
    font_cache_dir: str = "/usr/share/fonts/truetype/vcm-cache"

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
