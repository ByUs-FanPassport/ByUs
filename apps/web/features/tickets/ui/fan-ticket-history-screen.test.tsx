import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const item = (older: boolean) => ({ id: older ? "44444444-4444-4444-8444-444444444444" : "33333333-3333-4333-8333-333333333333", sequence: older ? 10 : 20, sourceType: older ? "benefit_entry_refund" : "verification", label: "팬 인증", amount: 1, createdAt: "2026-09-15T01:00:00.000Z", occurredAt: "2026-09-14T01:00:00.000Z", backfill: !older, balance: older ? 1 : 2 });
  const result = (older: boolean) => ({ state: { status: "ready", data: { enabled: true, creator: { slug: "elina", name: "Elina" }, balance: 2, today: "2026-09-15", actions: [], history: [item(older)], nextBefore: older ? null : "20" } }, retry: vi.fn(), refreshFailed: false });
  return { urls: [] as (string | null)[], initial: result(false), older: result(true), sdkOwner: "owner", sessionOwner: "owner", sessionReady: true };
});
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true, user: { id: mocks.sdkOwner }, getAccessToken: vi.fn() }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: mocks.sessionReady, ownerId: mocks.sessionOwner, generation: 0 }) }));
vi.mock("@/components/fan-shell/fan-app-shell", () => ({ FanAppFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>, FanContentContainer: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("./fan-ticket-guide", () => ({ FanTicketGuide: () => <div>guide</div> }));
vi.mock("@/components/fan-ui/use-owned-fan-resource", () => ({ useOwnedFanResource: (url: string | null) => {
  mocks.urls.push(url);
  return url?.includes("before=20") ? mocks.older : mocks.initial;
} }));
import { FanTicketHistoryScreen } from "./fan-ticket-history-screen";

describe("FanTicketHistoryScreen", () => {
  it("shows localized balance, backfill detail, and requests the server cursor for older rows", async () => {
    render(<FanTicketHistoryScreen creatorSlug="elina" creatorName="Elina" locale="en" />);
    expect(await screen.findByRole("heading", { name: "My ticket history" })).toBeInTheDocument();
    expect(await screen.findByText("Fan verification")).toBeInTheDocument();
    expect(screen.getByText(/Backfilled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older activity" }));
    expect(await screen.findByText(/Ticket refund/)).toBeInTheDocument();
    expect(mocks.urls.some((url) => url?.includes("creator=elina&locale=en&before=20"))).toBe(true);
  });
  it("removes retained rows while the authenticated identity is changing", async () => {
    const view = render(<FanTicketHistoryScreen creatorSlug="elina" creatorName="Elina" locale="en" />);
    expect(await screen.findByText("Fan verification")).toBeInTheDocument();
    mocks.sdkOwner = "owner-b"; mocks.sessionReady = false;
    view.rerender(<FanTicketHistoryScreen creatorSlug="elina" creatorName="Elina" locale="en" />);
    expect(screen.queryByText("Fan verification")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading ticket history");
    mocks.sdkOwner = "owner"; mocks.sessionReady = true;
  });
});
