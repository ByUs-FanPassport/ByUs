import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyScreen } from "./my-screen";

const id = "11111111-1111-4111-8111-111111111111";
const benefitId = "22222222-2222-4222-8222-222222222222";
const summary = {
  profile: { nickname: "카밀리아" },
  creators: [{
    celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" },
    relationship: "passport",
    passport: { id, tier: "Silver", score: 15, remainingToNextTier: 35 },
    ticketBalance: 4,
    firstReaction: { completedAt: "2026-09-03T00:00:00.000Z", txHash: null },
  }],
  live: { upcoming: [], history: [] },
  rewards: {
    availableCount: 2,
    entries: 3,
    items: [{
      rewardResultId: "33333333-3333-4333-8333-333333333333",
      winnerId: "44444444-4444-4444-8444-444444444444",
      benefitId,
      title: "ByUs Watch Party 기념 코드",
      campaignId: "55555555-5555-4555-8555-555555555555",
      result: "won",
      method: "on_site_pickup",
      status: "pickup_completed",
      enteredTickets: 1,
      recipientRequired: false,
      updatedAt: "2026-09-03T00:00:00.000Z",
      benefitHref: `/benefits/${benefitId}`,
    }],
  },
  collection: { passportCount: 1, stampCount: 2, collectibleCount: 0, recent: [] },
  unreadNotificationCount: 1,
};
const getAccessToken = vi.fn(async () => "token");

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));

describe("unified MY hub", () => {
  it("prioritizes profile identity, activity totals, and the four owner activity sections", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByRole("heading", { name: "카밀리아님", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("최애와 함께한 기록을 한눈에 모았어요.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "활동 요약" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 최애" })).toBeInTheDocument();
    expect(screen.getByText("실버 · 15 Score · 35 점 남음")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "다가오는 LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "받은 혜택" })).toBeInTheDocument();
    expect(screen.getByText("수령 완료")).toBeInTheDocument();
    expect(screen.queryByText("pickup_completed")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "최근 수집" })).toBeInTheDocument();
    expect(screen.getByText("알림 설정").closest("a")).toHaveAttribute("href", "/settings?locale=ko");
  });

  it("renders natural, explicit empty states", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      summary: {
        ...summary,
        creators: [],
        rewards: { availableCount: 0, entries: 0, items: [] },
        collection: { passportCount: 0, stampCount: 0, collectibleCount: 0, recent: [] },
      },
    })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByText("아직 등록한 최애가 없어요.")).toBeInTheDocument();
    expect(screen.getByText("예약한 LIVE가 없어요.")).toBeInTheDocument();
    expect(screen.getByText("아직 받은 혜택이 없어요.")).toBeInTheDocument();
    expect(screen.getByText("아직 수집한 기록이 없어요.")).toBeInTheDocument();
  });
});
