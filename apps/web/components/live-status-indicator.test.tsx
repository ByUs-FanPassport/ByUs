import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LiveStatusIndicator } from "./live-status-indicator";

describe("LIVE status density", () => {
  it("preserves the default comfortable treatment", () => {
    render(<LiveStatusIndicator status="scheduled" locale="ko" />);
    expect(screen.getByText("LIVE 예정")).toHaveAttribute("data-density", "comfortable");
  });
  it("makes catalog density explicit without changing status meaning", () => {
    render(<LiveStatusIndicator status="live" locale="en" density="compact" />);
    expect(screen.getByText("LIVE NOW")).toHaveAttribute("data-density", "compact");
    expect(screen.getByText("LIVE NOW")).toHaveAttribute("data-live-status", "live");
  });
  it("owns compact geometry in the shared stylesheet, independent of import order", () => {
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    expect(read("components/live-status-indicator.module.css")).toContain('.status[data-density="compact"] { min-height: 0; }');
    expect(read("features/live/ui/live-catalog-screen.module.css")).not.toContain(".catalogStatus");
    expect(read("features/live/ui/live-catalog-screen.tsx")).toContain('density="compact"');
  });
});
