/** Display helpers. Kept pure so they're trivial to reason about and test. */

export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  // Hours are omitted entirely for short clips: "4:07" reads better than
  // "0:04:07" for the common case.
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Subtitle-style timecode: MM:SS.mmm, or HH:MM:SS.mmm past an hour.
 *
 * Milliseconds are shown because caption timing is edited at that precision —
 * "0:04" would hide the difference between two adjacent captions.
 */
export function formatTimecode(ms: number): string {
  // Floor first. This is fed from `video.currentTime`, which is a float in
  // seconds, so ms arrives as 16159.78799999999865 — and `padStart` on a
  // fractional number is a no-op, printing "00:16.159.78799999999865".
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const millis = clamped % 1000;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const base = `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;

  return hours > 0 ? `${hours}:${base}` : base;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // One decimal below 10 ("1.4 MB"), none above ("237 MB") — precision that
  // stops being useful as the number grows.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

export function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");

  const days = Math.floor(hours / 24);
  if (days < 30) return plural(days, "day");

  // Past a month, an absolute date is more useful than "3 months ago".
  return new Date(iso).toLocaleDateString();
}
