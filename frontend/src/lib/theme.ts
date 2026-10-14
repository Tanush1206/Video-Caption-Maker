/**
 * Shared theme constants.
 *
 * Deliberately NOT inside a "use client" module: the pre-paint script in
 * app/layout.tsx is rendered on the server, and values imported from client
 * modules become client references there rather than the literal string.
 */

export type Theme = "light" | "dark";

/** localStorage key holding the user's explicit theme choice. */
export const THEME_STORAGE_KEY = "vcm-theme";

/**
 * What the user chose. "system" follows the OS and is stored as *no* key, so
 * the pre-paint script in app/layout.tsx (which falls back to the OS when
 * nothing is stored) needs no change and an older stored value still works.
 */
export type ThemePreference = Theme | "system";
