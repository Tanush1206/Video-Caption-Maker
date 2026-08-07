export interface SearchResult {
  video_id: number;
  caption_id: number;
  start_ms: number;
  end_ms: number;
  text: string;
  /** Similarity in 0..1; 1 is an exact match. */
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
}

/**
 * A source the answer leaned on.
 *
 * The timestamp is ours, resolved from the caption we retrieved — the model
 * only ever emits an excerpt number, so it cannot invent a plausible-looking
 * time that points nowhere.
 */
export interface Citation {
  index: number;
  video_id: number;
  caption_id: number;
  start_ms: number;
  text: string;
}

export interface AskResponse {
  question: string;
  answer: string;
  /** False when the transcript didn't answer — an honest miss, not a result. */
  grounded: boolean;
  citations: Citation[];
  results: SearchResult[];
}
