import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PlatformDashboardContent } from "./platform-dashboard";
import { createCsv } from "./performance-table";
const m = (value: any, source = "source") => ({
  state: "available" as const,
  value,
  reason: null,
  source,
});
const data: any = {
  totals: {
    fansAndWallets: m(2, "app_users/user_wallets"),
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
    expect(screen.getByRole("img", { name: /신규 가입/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "지갑 연결 회원" })).toBeInTheDocument();
    expect(screen.getByText("전체 가입자 수와 지갑 연결 회원 수가 일치할 때 표시됩니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA LIVE" })).toHaveAttribute(
      "href",
      "/admin/lives/22222222-2222-4222-8222-222222222222/analytics",
    );
    expect(
      screen.getByText("패스포트 1 · 첫 응원 1 · 스탬프 1 · 디지털 소장품 0"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "실패 작업 확인·재시도" }),
    ).toBeInTheDocument();
  });

  it("switches the chart metric and filters performance rows", () => {
    render(<PlatformDashboardContent data={{
      ...data,
      creators: m([
        ...data.creators.value,
        { ...data.creators.value[0], celebrityId: "33333333-3333-4333-8333-333333333333", name: "ELINA" },
      ]),
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "예약 건수" }));
    expect(screen.getByRole("img", { name: /예약 건수/ })).toBeInTheDocument();
    const creatorSection = screen.getByRole("heading", { name: "크리에이터 성과" }).closest("section")!;
    fireEvent.change(within(creatorSection).getByRole("searchbox"), { target: { value: "ELINA" } });
    expect(within(creatorSection).getByRole("status")).toHaveTextContent("전체 2건 중 1건");
    expect(within(creatorSection).getByRole("link", { name: "ELINA" })).toBeInTheDocument();
    expect(within(creatorSection).queryByRole("link", { name: "KARA" })).not.toBeInTheDocument();
  });

  it("creates Excel-readable CSV for all supplied rows and neutralizes formulas", () => {
    const csv = createCsv(
      [{ key: "name", label: "Name", value: (row: { name: string }) => row.name }],
      [{ name: "=cmd()" }, { name: "\tSUM(A1:A2)" }, { name: "KARA" }],
    );
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"'=cmd()\"");
    expect(csv).toContain("\"'\tSUM(A1:A2)\"");
    expect(csv).toContain("\"KARA\"");
  });

  it("sorts and paginates creator rows", () => {
    const creators = Array.from({ length: 11 }, (_, index) => ({
      ...data.creators.value[0],
      celebrityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Creator ${String(index + 1).padStart(2, "0")}`,
      fans: index,
    }));
    render(<PlatformDashboardContent data={{ ...data, creators: m(creators) }} />);
    const section = screen.getByRole("heading", { name: "크리에이터 성과" }).closest("section")!;
    expect(within(section).getByRole("link", { name: "Creator 01" })).toBeInTheDocument();
    expect(within(section).queryByRole("link", { name: "Creator 11" })).not.toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "다음" }));
    expect(within(section).getByRole("link", { name: "Creator 11" })).toBeInTheDocument();
    fireEvent.change(within(section).getByRole("combobox"), { target: { value: "fans" } });
    fireEvent.click(within(section).getByRole("button", { name: "오름차순" }));
    expect(within(section).getByRole("link", { name: "Creator 11" })).toBeInTheDocument();
  });

  it("keeps raw provenance in one optional technical disclosure", () => {
    render(<PlatformDashboardContent data={data} />);
    const details = screen.getByText("기술 정보").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(within(details!).getByText("app_users/user_wallets")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "누적 팬" })).toBeInTheDocument();
  });
});
