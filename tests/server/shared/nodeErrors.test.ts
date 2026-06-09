import { describe, expect, it } from "vitest";

import { isNodeErrorCode } from "../../../src/server/shared/nodeErrors";

describe("node error helpers", () => {
  it("matches objects with the requested Node error code", () => {
    expect(isNodeErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
  });

  it("rejects null, primitives, and mismatched codes", () => {
    expect(isNodeErrorCode(null, "ENOENT")).toBe(false);
    expect(isNodeErrorCode("ENOENT", "ENOENT")).toBe(false);
    expect(isNodeErrorCode({ code: "EEXIST" }, "ENOENT")).toBe(false);
    expect(isNodeErrorCode({}, "ENOENT")).toBe(false);
  });
});
