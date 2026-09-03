import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MyScreen } from "./my-screen";

const getAccessToken = vi.fn(async () => "token");

const summary = {
  profile: { nickname: "카밀리아" },
  passports: [{
    id: "11111111-1111-4111-8111-111111111111",
    celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" },
    issuedAt: "2026-09-03T00:00:00.000Z",
    stampCount: 2,
    score: { level: "Silver" },
    display: { level: "실버" },
    progress: { currentScore: 15, currentLevel: "Silver", nextLevel: "Gold", nextThreshold: 50, remainingPoints: 35, percent: 30, maxed: false },
    stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 },
    stamps: [],
  }],
  reservations: [],
  availableBenefitCount: 0,
  unreadNotificationCount: 0,
};

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, getAccessToken }),
}));

describe("MY fan Tier milestone", () => {
  it("renders the v2 next Tier and remaining score", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByText("실버 → 골드 · 35점 남음")).toBeInTheDocument();
    expect(screen.queryByText(/10점|20점|35점 달성/)).not.toBeInTheDocument();
  });

  it("renders Diamond as maxed without a fabricated threshold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      summary: {
        ...summary,
        passports: [{
          ...summary.passports[0],
          score: { level: "Diamond" },
          display: { level: "다이아몬드" },
          progress: { currentScore: 250, currentLevel: "Diamond", nextLevel: null, nextThreshold: null, remainingPoints: 0, percent: 100, maxed: true },
        }],
      },
    })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByText("다이아몬드 · 최고 Level에 도달했어요.")).toBeInTheDocument();
    expect(screen.queryByText(/다음.*점/)).not.toBeInTheDocument();
  });
});
