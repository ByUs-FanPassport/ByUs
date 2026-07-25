import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import CreditsPage from "./page";
import { katseyeAttribution } from "./katseye-attribution";

describe("CreditsPage", () => {
  it.each([
    ["ko", "Creative Commons 저작자표시 4.0 라이선스 열기, 새 창"],
    ["en", "Open the Creative Commons Attribution 4.0 license, new window"],
  ] as const)("announces new-window license links in %s", async (locale, accessibleName) => {
    render(await CreditsPage({ searchParams: Promise.resolve({ locale }) }));

    const links = screen.getAllByRole("link", { name: accessibleName });
    expect(links).toHaveLength(katseyeAttribution.sources.length);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });
});
