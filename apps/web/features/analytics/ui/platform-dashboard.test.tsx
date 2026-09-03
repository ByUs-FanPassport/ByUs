import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PlatformDashboardContent } from "./platform-dashboard";
const m = (value: any, source = "source") => ({
  state: "available" as const,
  value,
  reason: null,
  source,
});
const data: any = {
  totals: {
    fansAndWallets: m(2),
    passports: m(1),
    activeCreators: m(1),
    firstReactions: m(1),
    reservations: m(1),
    attendances: m(0),
    onchainActions: m(3),
  },
  trend: m([
    {
      date: "2026-09-04",
      newFans: 1,
      passports: 1,
      reactions: 1,
      reservations: 1,
      attendances: 0,
      transactions: 3,
    },
  ]),
  creators: m([
    {
      celebrityId: "11111111-1111-4111-8111-111111111111",
      name: "KARA",
      fans: 2,
      passports: 1,
      reactions: 1,
      reservations: 1,
      attendances: 0,
      transactions: 3,
    },
  ]),
  lives: m([
    {
      liveEventId: "22222222-2222-4222-8222-222222222222",
      title: "KARA LIVE",
      startsAt: "2026-09-04T00:00:00Z",
      reservations: 1,
      attendances: 0,
      transactions: 2,
    },
  ]),
  chain: {
    total: m(3),
    uniqueFans: m(2),
    successful: m(2),
    pending: m(1),
    failed: m(0),
    breakdown: m({ passport: 1, reaction: 1, stamp: 1, collectible: 0 }),
  },
};
describe("PlatformDashboardContent", () => {
  it("renders KPIs, accessible trend table, Creator/LIVE drilldown and chain actions", () => {
    render(<PlatformDashboardContent data={data} />);
    expect(
      screen.getByRole("heading", { name: "기간 추이" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA LIVE" })).toHaveAttribute(
      "href",
      "/admin/lives/22222222-2222-4222-8222-222222222222/analytics",
    );
    expect(
      screen.getByText("Passport 1 · Reaction 1 · Stamp 1 · Collectible 0"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "실패 작업 확인·재시도" }),
    ).toBeInTheDocument();
  });
});
