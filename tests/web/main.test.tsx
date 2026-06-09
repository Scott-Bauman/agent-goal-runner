// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderMock = vi.fn();
const unmountMock = vi.fn();
const createRootMock = vi.fn(() => ({
  render: renderMock,
  unmount: unmountMock,
}));

describe("web entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-dom/client", () => ({
      createRoot: createRootMock,
    }));
    vi.doMock("../../src/web/App", () => ({
      App: () => "App",
    }));
    createRootMock.mockClear();
    renderMock.mockClear();
    unmountMock.mockClear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.doUnmock("react-dom/client");
    vi.doUnmock("../../src/web/App");
  });

  it("mounts the app into the root element", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/web/main");

    expect(createRootMock).toHaveBeenCalledWith(
      document.getElementById("root"),
    );
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the root element is missing", async () => {
    await expect(import("../../src/web/main")).rejects.toThrow(
      "Missing root element",
    );
    expect(createRootMock).not.toHaveBeenCalled();
  });
});

