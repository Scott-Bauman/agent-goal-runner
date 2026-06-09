// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RunnerStatusBadge } from "../../../../src/web/components/app/RunnerStatusBadge";
import {
  statusBadgeConfig,
  type RunnerStatus,
} from "../../../../src/web/runner/statuses";

import "./componentTestUtils";

describe("RunnerStatusBadge", () => {
  it.each(Object.keys(statusBadgeConfig) as RunnerStatus[])(
    "renders the configured label and status semantics for %s",
    (status) => {
      render(<RunnerStatusBadge status={status} />);

      const badge = screen.getByRole("status", {
        name: `Runner status: ${statusBadgeConfig[status].label}`,
      });

      expect(badge.textContent).toContain(statusBadgeConfig[status].label);
    },
  );

  it("shows an activity indicator only while running", () => {
    const { rerender } = render(<RunnerStatusBadge status="running" />);

    expect(
      screen
        .getByRole("status", { name: "Runner status: Running" })
        .querySelector(".animate-ping"),
    ).not.toBeNull();

    rerender(<RunnerStatusBadge status="idle" />);

    expect(
      screen
        .getByRole("status", { name: "Runner status: Idle" })
        .querySelector("span"),
    ).toBeNull();
  });
});
