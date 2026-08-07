export interface Caption {
  id: number;
  sequence: number;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Whisper's average log-probability; lower means less certain. */
  confidence: number | null;
}

export interface CaptionList {
  items: Caption[];
  total: number;
}
