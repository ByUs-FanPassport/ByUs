import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyticsWindowControl,
  analyticsWindowFromSearch,
  defaultAnalyticsWindow,
} from "./analytics-window-control";
describe("AnalyticsWindowControl", () => {
  it("restores a valid shareable window and rejects invalid query state", () => {
    const fallback = defaultAnalyticsWindow(new Date("2026-09-04T00:00:00Z"));
    expect(
      analyticsWindowFromSearch(
        "?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-03T00%3A00%3A00.000Z&asOf=2026-09-04T00%3A00%3A00.000Z",
        fallback,
      ),
    ).toEqual({
      preset: "custom",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-03T00:00:00.000Z",
      asOf: "2026-09-04T00:00:00.000Z",
    });
    expect(
      analyticsWindowFromSearch(
        "?from=2026-09-04T00%3A00%3A00.000Z&to=2026-09-03T00%3A00%3A00.000Z&asOf=2026-09-04T00%3A00%3A00.000Z",
        fallback,
      ),
    ).toBe(fallback);
  });
  it("offers Today, 7D, 30D and Custom with canonical output", () => {
    const apply = vi.fn();
    render(
      <AnalyticsWindowControl
        value={defaultAnalyticsWindow(new Date("2026-09-04T00:00:00Z"))}
        onApply={apply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "7D" }));
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "7d" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 설정" }));
    expect(screen.getByLabelText("시작")).toBeInTheDocument();
  });
  it("rejects an inverted custom interval", () => {
    render(
      <AnalyticsWindowControl
        value={defaultAnalyticsWindow()}
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "직접 설정" }));
    fireEvent.change(screen.getByLabelText("시작"), {
      target: { value: "2026-09-04T10:00" },
    });
    fireEvent.change(screen.getByLabelText("종료"), {
      target: { value: "2026-09-04T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
