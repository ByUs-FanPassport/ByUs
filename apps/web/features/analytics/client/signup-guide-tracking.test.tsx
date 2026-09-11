import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignupGuideLink, SignupGuideView } from "./signup-guide-tracking";
import { signupFunnelTracker } from "./signup-funnel-tracker";

let ready = false;
let authenticated = false;
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready, authenticated }) }));

describe("guide tracking preserves existing navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not wait for auth readiness to observe a view", () => {
    ready = false;
    const view = vi.spyOn(signupFunnelTracker, "guideView").mockImplementation(() => undefined);
    const { rerender, container } = render(<SignupGuideView guide="elina" locale="ko" />);
    expect(view).toHaveBeenCalledWith("elina", "ko", "unknown");
    expect(container).toBeEmptyDOMElement();
    ready = true;
    rerender(<SignupGuideView guide="elina" locale="ko" />);
    expect(view).toHaveBeenLastCalledWith("elina", "ko", "guest");
    // The tracker itself dedupes repeated effects; it never rewrites the first audience.
  });

  it("records the current audience without canceling or awaiting the link action", () => {
    ready = true; authenticated = false;
    const cta = vi.spyOn(signupFunnelTracker, "guideCta").mockImplementation(() => undefined);
    render(<SignupGuideLink guide="elina" locale="en" action="verify" placement="hero" href="#verify" className="existing-action">Verify</SignupGuideLink>);
    const link = screen.getByRole("link", { name: "Verify" });
    expect(fireEvent.click(link)).toBe(true);
    expect(cta).toHaveBeenCalledWith("elina", "en", "guest", "verify", "hero");
    expect(link).toHaveAttribute("href", "#verify");
    expect(link).toHaveClass("existing-action");
  });
});
