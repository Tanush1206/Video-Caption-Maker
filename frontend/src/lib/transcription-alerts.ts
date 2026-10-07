"use client";

/**
 * Telling someone their transcription finished, after they walked away from it.
 *
 * Transcribing is minutes of GPU work, so the useful thing to do while it runs
 * is something else. That only works if the app can reach back out when it is
 * done — otherwise "come back later" means "keep checking".
 *
 * Two halves, kept together because they are one promise to the user: the list
 * of jobs we said we would report on, and the mechanism for reporting.
 *
 * The list lives in localStorage rather than in React state or a module
 * variable, because the whole point is that it outlives the screen that
 * created it — including a hard reload, which is the exact moment someone
 * wonders whether their job survived.
 */

const STORAGE_KEY = "vcm.transcribing";

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * The current ids, held as one array that is only *replaced* when the contents
 * change. `useSyncExternalStore` compares snapshots by identity and throws if
 * a fresh array comes back every call, so parsing localStorage on demand is
 * not an option.
 */
let snapshot: number[] = [];
let loaded = false;

/** SSR has no localStorage; one frozen empty array keeps the identity stable. */
const EMPTY: number[] = [];

function parse(): number[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];
  } catch {
    // Private mode, a quota error, or someone else's malformed value. Losing
    // the watch list costs a notification; throwing here would cost the page.
    return [];
  }
}

function persist(ids: number[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Same reasoning: the in-memory list still works for this tab.
  }
}

function same(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function announce(next: number[]): void {
  if (same(next, snapshot)) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent): void {
  // `key` is null when storage is cleared wholesale.
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  announce(parse());
}

export function subscribeWatched(listener: Listener): () => void {
  listeners.add(listener);
  // A job started in another tab is still this user's job, and the `storage`
  // event is the only way this tab hears about it.
  if (listeners.size === 1) window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getWatched(): number[] {
  if (!loaded) {
    loaded = true;
    snapshot = parse();
  }
  return snapshot;
}

/** The server render has nothing to watch, and must not touch localStorage. */
export function getWatchedOnServer(): number[] {
  return EMPTY;
}

export function watchTranscription(id: number): void {
  const current = getWatched();
  if (current.includes(id)) return;
  const next = [...current, id];
  persist(next);
  announce(next);
}

export function unwatchTranscription(id: number): void {
  const current = getWatched();
  if (!current.includes(id)) return;
  const next = current.filter((watched) => watched !== id);
  persist(next);
  announce(next);
}

// ── Notifications ───────────────────────────────────────────────────────────

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Ask for permission, if it has not already been settled.
 *
 * Must be called straight out of a click handler and **not** awaited before
 * the work it accompanies: browsers only honour `requestPermission` while the
 * user's gesture is still the reason the code is running, and blocking the
 * transcription request on someone reading a permission dialog would make the
 * button feel broken.
 *
 * Re-asking after a denial is both pointless (the browser answers instantly
 * from its own record) and the behaviour that gets a site's notifications
 * permanently muted, so "default" is the only state worth prompting from.
 */
export function askToNotify(): void {
  if (!supported() || Notification.permission !== "default") return;
  try {
    void Notification.requestPermission();
  } catch {
    // Older Safari only has the callback form and rejects the promise one.
  }
}

/** Whether a finished job will actually reach the user, or just the tab. */
export function willNotify(): boolean {
  return supported() && Notification.permission === "granted";
}

export function notify(title: string, body: string, onClick?: () => void): void {
  if (!willNotify()) return;
  try {
    const notification = new Notification(title, { body, icon: "/favicon.ico" });
    if (onClick) {
      notification.onclick = () => {
        // The tab is usually in the background — that is why this exists.
        window.focus();
        notification.close();
        onClick();
      };
    }
  } catch {
    // Android Chrome throws here and requires a service worker instead. The
    // job still finished and the dashboard still shows it; only the popup is
    // missing, which is not worth an error boundary.
  }
}
