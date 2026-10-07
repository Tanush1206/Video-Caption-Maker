"""What the install is running on, and the settings a local user can change."""

from pydantic import BaseModel, Field


class HardwareInfo(BaseModel):
    cuda: bool
    gpu_name: str | None
    vram_gb: float | None
    ram_gb: float
    cpu_count: int


class WhisperInfo(BaseModel):
    model: str
    device: str
    compute_type: str
    # Where the model choice came from: "user" (Settings), "env" or "auto".
    source: str


class Choice(BaseModel):
    value: str
    label: str


class SystemInfo(BaseModel):
    auth_mode: str
    # None until the worker has started once and reported in.
    hardware: HardwareInfo | None
    whisper: WhisperInfo | None
    whisper_choice: str
    whisper_choices: list[Choice]
    translation_engine: str  # "gemini" or "local"
    translator_model: str | None
    # Whether a key is set. The key itself is never sent back out.
    gemini_configured: bool
    # "settings" (removable from the UI), "env", or None.
    gemini_source: str | None = None


class SystemSettingsUpdate(BaseModel):
    # Omit a field to leave it alone. An empty string or null clears the key.
    gemini_api_key: str | None = Field(default=None, max_length=200)
    whisper_model: str | None = None
