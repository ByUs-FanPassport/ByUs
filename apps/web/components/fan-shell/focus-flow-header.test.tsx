import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FocusFlowHeader } from "./focus-flow-header";

describe("FocusFlowHeader", () => {
  it("provides the canonical wordmark target and preserves contextual controls", () => {
    render(
      <FocusFlowHeader sticky>
        <a href="?locale=en">KO / EN</a>
      </FocusFlowHeader>,
    );

    const banner = screen.getByRole("banner");
    const home = within(banner).getByRole("link", { name: "ByUs 홈" });
    expect(home).toHaveAttribute("href", "/");
    expect(within(home).getByRole("img", { name: "ByUs" })).toBeInTheDocument();
    expect(within(banner).getByRole("link", { name: "KO / EN" })).toHaveAttribute("href", "?locale=en");
  });
});
