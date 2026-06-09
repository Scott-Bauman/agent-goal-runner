import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";

import { SidebarProvider } from "../../../../src/web/components/ui/sidebar";
import {
  INITIAL_RUNTIME_STREAM_STATE,
  type RuntimeStreamState,
} from "../../../../src/web/events/runtimeStream";

export function renderWithSidebar(ui: ReactNode) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

export function createRuntimeStreamState(
  overrides: Partial<RuntimeStreamState> = {},
): RuntimeStreamState {
  return {
    ...INITIAL_RUNTIME_STREAM_STATE,
    ...overrides,
    progress: {
      ...INITIAL_RUNTIME_STREAM_STATE.progress,
      ...overrides.progress,
    },
    runDetails: {
      ...INITIAL_RUNTIME_STREAM_STATE.runDetails,
      ...overrides.runDetails,
      skillPreflight: {
        ...INITIAL_RUNTIME_STREAM_STATE.runDetails.skillPreflight,
        ...overrides.runDetails?.skillPreflight,
      },
    },
  };
}

export function jsonResponse<TBody>(
  body: TBody,
  {
    ok = true,
    status = ok ? 200 : 500,
  }: {
    ok?: boolean;
    status?: number;
  } = {},
): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
  });
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
