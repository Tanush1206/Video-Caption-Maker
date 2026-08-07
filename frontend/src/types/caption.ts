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

/** Both halves returned by a split, so the client needn't refetch to know them. */
export interface CaptionPair {
  first: Caption;
  second: Caption;
}
