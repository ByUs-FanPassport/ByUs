import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticated: true, state: { status: "loading" } as unknown, retry: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: mocks.authenticated, user: { id: "owner" }, getAccessToken: vi.fn() }) }));
vi.mock("@/components/fan-ui/use-owned-fan-resource", () => ({ useOwnedFanResource: () => ({ state: mocks.state, retry: mocks.retry, refreshFailed: false }) }));
vi.mock("@/components/auth-intent-link", () => ({ AuthIntentLink: ({ children }: { children: React.ReactNode }) => <a href="/login">{children}</a> }));
import { FanTicketGuide } from "./fan-ticket-guide";

const ready = {
  status: "ready", data: {
    enabled: true, creator: { slug: "elina", name: "엘리나" }, balance: 4, today: "2026-09-15", nextBefore: null, history: [],
    actions: [
      { key: "verification", amount: 1, status: "awarded", href: "/c/elina/verify" },
      { key: "membership_instagram", amount: 1, status: "pending", href: "/elina?tab=certifications" },
      { key: "checkin", amount: 1, status: "available", href: "/elina#daily-checkin" },
    ],
  },
};

describe("FanTicketGuide", () => {
  beforeEach(() => { mocks.authenticated = true; mocks.state = { status: "loading" }; mocks.retry.mockClear(); });
  it("shows a generic sign-in invitation to guests only for enabled campaign creators", () => {
    mocks.authenticated = false;
    const { rerender } = render(<FanTicketGuide creatorSlug="elina" creatorName="엘리나" locale="ko" />);
    expect(screen.getByRole("heading", { name: "응모권 모으기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /로그인하고 확인/ })).toBeInTheDocument();
    rerender(<FanTicketGuide creatorSlug="kara" creatorName="KARA" locale="ko" />);
    expect(screen.queryByRole("heading", { name: "응모권 모으기" })).not.toBeInTheDocument();
  });
  it("renders awarded, pending, and available activity states with localized links", () => {
    mocks.state = ready;
    render(<FanTicketGuide creatorSlug="elina" creatorName="Elina" locale="en" />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/Awarded/)).toBeInTheDocument();
    expect(screen.getByText(/Verification pending/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Today's check-in/ })).toHaveAttribute("href", "/elina?locale=en#daily-checkin");
    expect(screen.getByRole("link", { name: /View ticket history/ })).toHaveAttribute("href", "/c/elina/tickets?locale=en");
  });
  it("keeps malformed or unavailable owner data behind an error state", () => {
    mocks.state = { status: "error", kind: "network" };
    render(<FanTicketGuide creatorSlug="yuna" creatorName="유나" locale="ko" />);
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했어요");
    screen.getByRole("button", { name: "다시 시도" }).click();
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});
