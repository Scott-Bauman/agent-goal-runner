// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getInitialThemeMode,
  persistThemeMode,
} from "../../../../src/web/components/app/topBarTheme";

const THEME_STORAGE_KEY = "agent-goal-runner-theme";

describe("top bar theme helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
  });

  it("uses a stored theme when it is valid", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    expect(getInitialThemeMode()).toBe("dark");
  });

  it("falls back to the OS color scheme preference", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    });

    expect(getInitialThemeMode()).toBe("dark");
  });

  it("ignores invalid and unavailable stored values", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");

    expect(getInitialThemeMode()).toBe("light");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(getInitialThemeMode()).toBe("light");
  });

  it("persists the theme and updates document styling", () => {
    persistThemeMode("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    persistThemeMode("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("still updates the document when storage persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    persistThemeMode("dark");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

