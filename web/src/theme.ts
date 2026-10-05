import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const storageKey = "vigil.theme";
const darkQuery = "(prefers-color-scheme: dark)";

export const themeLabels: Record<ThemePreference, string> = {
  system: "Sistem teması",
  light: "Açık tema",
  dark: "Koyu tema",
};

// The preference is a per-browser convenience; storage may be unavailable
// (private window, blocked site data) and the page must still render.
export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* fall back to the system theme */
  }
  return "system";
}

function writeThemePreference(value: ThemePreference) {
  try {
    if (value === "system") window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, value);
  } catch {
    /* the choice still applies to this page */
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(darkQuery).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function nextThemePreference(value: ThemePreference): ThemePreference {
  return value === "system" ? "light" : value === "light" ? "dark" : "system";
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));
  useEffect(() => {
    setResolved(applyTheme(preference));
    if (preference !== "system" || !window.matchMedia) return;
    const media = window.matchMedia(darkQuery);
    const change = () => setResolved(applyTheme("system"));
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [preference]);
  const choose = useCallback((value: ThemePreference) => {
    writeThemePreference(value);
    setPreference(value);
  }, []);
  return { preference, resolved, choose };
}
