export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "agent-goal-runner-theme";

export function getNextThemeMode(theme: ThemeMode): ThemeMode {
  return theme === "dark" ? "light" : "dark";
}

export function getThemeToggleLabel(theme: ThemeMode): string {
  return theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function getStoredTheme(storage: Storage | null): ThemeMode | null {
  try {
    const theme = storage?.getItem(THEME_STORAGE_KEY);

    return theme === "dark" || theme === "light" ? theme : null;
  } catch {
    return null;
  }
}

export function getInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = getStoredTheme(window.localStorage);

  if (storedTheme) {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function persistThemeMode(theme: ThemeMode): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is a convenience; the UI should still toggle.
  }
}
