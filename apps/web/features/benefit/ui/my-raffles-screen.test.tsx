import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyRafflesScreen } from "./my-raffles-screen";

const getAccessToken = vi.fn(async () => "token");
let authenticated = true;
let userId = "owner-a";
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, user: { id: userId }, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/my/raffles",
  useSearchParams: () => new URLSearchParams("locale=ko"),
}));

const pending = {
  benefitId: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  title: "전시 관람권",
  benefitHref: "/benefits/11111111-1111-4111-8111-111111111111",
  state: "pending",
  enteredTickets: 2,
  entryClosesAt: "2026-09-20T00:00:00+09:00",
  publishedAt: null,
  winnerId: null,
  method: "on_site_pickup",
  fulfillmentStatus: null,
  claimDisposition: "active",
  recipientDeadlineAt: null,
  recipientSubmitted: false,
  recipientEditable: false,
  policy: null,
} as const;

describe("MyRafflesScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authenticated = true;
    userId = "owner-a";
  });

  it("keeps every result state and loads the next cursor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("cursor=older")) return Promise.resolve(Response.json({ items: [{
        ...pending,
        benefitId: "44444444-4444-4444-8444-444444444444",
        campaignId: "55555555-5555-4555-8555-555555555555",
        benefitHref: "/benefits/44444444-4444-4444-8444-444444444444",
        title: "배송 경품",
        state: "not_won",
        publishedAt: "2026-09-21T00:00:00+09:00",
      }], nextCursor: null }));
      return Promise.resolve(Response.json({ items: [pending], nextCursor: "older" }));
    });
    render(<MyRafflesScreen locale="ko" />);
    expect(await screen.findByRole("heading", { name: "결과 발표를 기다리고 있어요" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이전 응모 내역 더 보기" }));
    expect(await screen.findByRole("heading", { name: "이번에는 당첨되지 않았어요" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("cursor=older"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses a login returnTo and never presents auth as not selected", () => {
    authenticated = false;
    render(<MyRafflesScreen locale="en" />);
    const link = screen.getByRole("link", { name: "Sign in to view raffle history" });
    expect(link.getAttribute("href")).toContain("returnTo=%2Fmy%2Fraffles%3Flocale%3Den");
    expect(screen.queryByText("You weren’t selected this time")).not.toBeInTheDocument();
  });

  it("drops the prior owner view immediately when the account changes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({ items: [
      { ...pending, title: userId === "owner-a" ? "Owner A private entry" : "Owner B private entry" },
    ], nextCursor: null })));
    const view = render(<MyRafflesScreen locale="en" />);
    expect(await screen.findByText("Owner A private entry")).toBeInTheDocument();
    userId = "owner-b";
    view.rerender(<MyRafflesScreen locale="en" />);
    expect(screen.queryByText("Owner A private entry")).not.toBeInTheDocument();
    expect(await screen.findByText("Owner B private entry")).toBeInTheDocument();
    await waitFor(() => expect(getAccessToken).toHaveBeenCalled());
  });
});
