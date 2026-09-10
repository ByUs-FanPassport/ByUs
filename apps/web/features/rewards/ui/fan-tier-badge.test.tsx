import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FanTierBadge } from "./fan-tier-badge";

describe("FanTierBadge", () => {
  it("uses the validated stage-key asset and stays decorative beside a visible label", () => {
    const { container } = render(<span><FanTierBadge tier="Platinum" stageKey="platinum-3" locale="ko" size={40} />플래티넘 3</span>);
    const badge = container.querySelector("img");
    expect(decodeURIComponent(badge!.getAttribute("src")!)).toContain("/images/passport/tiers/opal-heart/128/platinum-3.png");
    expect(badge).toHaveAttribute("alt", "");
    expect(badge).toHaveAttribute("width", "40");
  });

  it("falls back to the major tier entry asset and can expose its own name", () => {
    render(<FanTierBadge tier="Diamond" locale="en" size={88} adjacentLabel={false} />);
    expect(decodeURIComponent(screen.getByRole("img", { name: "Diamond fan tier" }).getAttribute("src")!)).toContain("/images/passport/tiers/opal-heart/256/diamond-1.png");
  });
});
