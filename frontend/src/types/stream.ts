/** A short-lived credential for the media URL, since <video> can't send headers. */
export interface StreamTicket {
  token: string;
  /** Seconds until the token stops working. */
  expires_in: number;
}

export interface Waveform {
  /** Amplitude peaks in 0..1, evenly spaced across the whole video. */
  peaks: number[];
  duration_ms: number | null;
}
