import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { LiveDashboardContent } from "./live-dashboard";
const m = (value: any, source = "source") => ({
    state: "available" as const,
    value,
    reason: null,
    source,
  }),
  ratio = (n: number, d: number) =>
    m({ numerator: n, denominator: d, rate: n / d });
const data: any = {
  funnel: {
    visits: m(10),
    reservations: m(5),
    reservationRate: ratio(5, 10),
    attendances: m(4),
    attendanceRate: ratio(4, 5),
  },
  relationships: { newFans: m(2), newPassports: m(2), firstReactions: m(3) },
  missions: m([
    {
      missionId: "11111111-1111-4111-8111-111111111111",
      title: "Quiz",
      type: "quiz",
      participants: 5,
      participationRate: 1,
      correct: 4,
      incorrect: 1,
      correctRate: 0.8,
      options: [],
    },
  ]),
  benefits: {
    ticketsEarned: m(8),
    ticketsUsed: m(3),
    applicants: m(2),
    winners: m(1),
  },
  journey: {
    eligible: m(5),
    complete: m(4),
    claims: m(3),
    claimRate: ratio(3, 4),
  },
  chain: {
    total: m(4),
    uniqueFans: m(2),
    successful: m(3),
    pending: m(1),
    failed: m(0),
    breakdown: m({ passport: 1, reaction: 1, stamp: 1, collectible: 1 }),
  },
};
describe("LiveDashboardContent", () => {
  it("keeps Mission outside the funnel and shows numerator/denominator", () => {
    render(<LiveDashboardContent data={data} />);
    expect(
      screen.getByRole("heading", { name: "방문 → 예약 → 출석" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "미션 (퍼널과 별도)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("5 / 10")).toBeInTheDocument();
    expect(screen.getByText(/정답 4/)).toBeInTheDocument();
  });
});
