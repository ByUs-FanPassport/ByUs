import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FocusFlowBrand } from "./focus-flow-brand";

describe("FocusFlowBrand", () => {
  it("renders the canonical wordmark as an accessible home target", () => {
    render(<FocusFlowBrand />);

    const home = screen.getByRole("link", { name: "kyaa 홈" });
    expect(home).toHaveAttribute("href", "/");
    expect(within(home).getByRole("img", { name: "kyaa" })).toHaveAttribute(
      "src",
      "/images/guest-home/kyaa-wordmark.svg",
    );
  });
});
