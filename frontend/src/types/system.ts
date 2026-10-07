export interface HardwareInfo {
  cuda: boolean;
  gpu_name: string | null;
  vram_gb: number | null;
  ram_gb: number;
  cpu_count: number;
}

export interface WhisperInfo {
  model: string;
  device: string;
  compute_type: string;
  /** Where the model choice came from: Settings, the environment, or the hardware. */
  source: "user" | "env" | "auto";
}

export interface SystemInfo {
  auth_mode: "local" | "accounts";
  /** Null until the worker has started once and reported what it runs on. */
  hardware: HardwareInfo | null;
  whisper: WhisperInfo | null;
  whisper_choice: string;
  whisper_choices: { value: string; label: string }[];
  translation_engine: "gemini" | "local";
  translator_model: string | null;
  gemini_configured: boolean;
  /** Only a key from Settings can be removed from Settings. */
  gemini_source: "settings" | "env" | null;
}

export interface SystemSettingsUpdate {
  /** An empty string removes the key. */
  gemini_api_key?: string;
  whisper_model?: string;
}
