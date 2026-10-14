"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { THEME_STORAGE_KEY, type Theme, type ThemePreference } from "@/lib/theme";

interface ThemeContextValue {
  /** The theme on screen. */
  theme: Theme;
  /** What the user chose; "system" follows the OS. */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Flip to the opposite of what is on screen, as an explicit choice. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyTheme(theme: Theme) {
  // tailwind.config.ts uses darkMode: ["class"], so the `dark` class on
  // <html> is what activates the .dark palette in globals.css.
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start from whatever the inline script already put on <html>, so the
  // provider agrees with the DOM on first render and we never flip twice.
  const [theme, setTheme] = useState<Theme>("light");
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setPreferenceState(readPreference());
  }, []);

  // While following the system, follow it live: an OS switching to dark at
  // sunset should take the app with it, without a reload.
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => {
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    const resolved = next === "system" ? systemTheme() : next;
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies for this page.
    }
    applyTheme(resolved);
    setTheme(resolved);
    setPreferenceState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [setPreference, theme]);

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}
