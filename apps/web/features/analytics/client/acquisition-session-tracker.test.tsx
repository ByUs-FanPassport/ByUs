// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  searchParams: new URLSearchParams(),
  record: vi.fn().mockResolvedValue(true),
  authenticated: false,
  getAccessToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: mocks.authenticated,
    getAccessToken: mocks.getAccessToken,
  }),
}));
vi.mock("./product-event-client", () => ({ recordProductEventV1: mocks.record }));

import { AcquisitionSessionTracker } from "./acquisition-session-tracker";

describe("AcquisitionSessionTracker", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.pathname = "/";
    mocks.searchParams = new URLSearchParams({
      utm_source: "person@example.com",
      utm_campaign: "private-campaign",
      utm_medium: "email",
      code: "oauth-secret",
    });
    mocks.record.mockClear().mockResolvedValue(true);
    mocks.authenticated = false;
    mocks.getAccessToken.mockReset().mockResolvedValue("token");
  });

  it("records only bounded first-touch properties", async () => {
    render(<AcquisitionSessionTracker />);
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));

    const payload = mocks.record.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      eventName: "creator_page_view",
      source: "acquisition.session_landing",
      occurredAt: expect.any(String),
      properties: { channel: "email", landing: "home", attribution: "session_first_touch" },
    });
    expect(JSON.stringify(payload)).not.toMatch(/person@example|private-campaign|oauth-secret/);
  });

  it("does not turn a later internal navigation into a session landing", async () => {
    mocks.pathname = "/login";
    const view = render(<AcquisitionSessionTracker />);
    expect(mocks.record).not.toHaveBeenCalled();

    mocks.pathname = "/c/elina";
    view.rerender(<AcquisitionSessionTracker />);
    await Promise.resolve();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("swallows authentication failures because measurement must not affect the page", async () => {
    mocks.authenticated = true;
    mocks.getAccessToken.mockRejectedValue(new Error("auth unavailable"));
    render(<AcquisitionSessionTracker />);

    await waitFor(() => expect(mocks.getAccessToken).toHaveBeenCalledTimes(1));
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
