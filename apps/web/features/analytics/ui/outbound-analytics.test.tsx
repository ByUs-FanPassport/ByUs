import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboundAnalyticsData } from "../domain/outbound-analytics";

const auth = vi.hoisted(() => ({ status: "authorized", email: "admin@example.invalid", getAccessToken: vi.fn(async (): Promise<string | null> => "admin-token") }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: auth.getAccessToken }) }));
vi.mock("../../../components/admin/use-admin-session", () => ({ useAdminSession: () => ({ status: auth.status, admin: { email: auth.email, role: "admin" } }) }));

import { OutboundAnalytics, OutboundAnalyticsContent } from "./outbound-analytics";

const data: OutboundAnalyticsData = {
  days: 7,
  from: "2026-10-05T00:00:00Z",
  to: "2026-10-12T00:00:00Z",
  totals: { clicks: 28, sessions: 19 },
  rows: [{ campaign: "runmusic", destinationHost: "wgrw.raceplan.co.kr", placement: "fanpage_hero", linkKind: "ticket", clicks: 18, sessions: 14 }],
  truncated: false,
};
const response = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }));

beforeEach(() => {
  auth.status = "authorized";
  auth.email = "admin@example.invalid";
  auth.getAccessToken.mockReset().mockResolvedValue("admin-token");
});

describe("OutboundAnalyticsContent", () => {
  it("shows totals and safe grouped dimensions with an accurate measurement note", () => {
    render(<OutboundAnalyticsContent data={data} locale="ko" />);
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "외부 링크 클릭 상세 목록" });
    expect(within(table).getByText("runmusic")).toBeInTheDocument();
    expect(within(table).getByText("wgrw.raceplan.co.kr")).toBeInTheDocument();
    expect(within(table).getByText("팬페이지 히어로")).toBeInTheDocument();
    expect(within(table).getByText("예매·참가 신청")).toBeInTheDocument();
    expect(screen.getByText(/사람 수나 구매 건수가 아닙니다/)).toBeInTheDocument();
    expect(screen.getByText(/컨텍스트 메뉴로 연 클릭은 측정하지 않습니다/)).toBeInTheDocument();
  });

  it("renders English empty and truncation states", () => {
    render(<OutboundAnalyticsContent data={{ ...data, rows: [], truncated: true }} locale="en" />);
    expect(screen.getByText("No outbound link clicks were recorded in this period.")).toBeInTheDocument();
    expect(screen.getByText("Showing the top 100 rows.")).toBeInTheDocument();
  });
});

describe("OutboundAnalytics", () => {
  it("requests the shared period with admin authentication and refreshes on demand", async () => {
    const fetcher = vi.fn((url: string) => response({ ...data, days: url.includes("days=30") ? 30 : 7 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<OutboundAnalytics days={7} refresh={0} locale="ko" />);
    await screen.findByText("wgrw.raceplan.co.kr");
    expect(fetcher).toHaveBeenCalledWith("/api/admin/analytics/outbound?days=7", expect.objectContaining({ headers: { authorization: "Bearer admin-token" }, cache: "no-store", signal: expect.any(AbortSignal) }));
    view.rerender(<OutboundAnalytics days={30} refresh={1} locale="ko" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/analytics/outbound?days=30", expect.anything()));
  });

  it("does not request denied sessions and reports API authorization rejection", async () => {
    auth.status = "denied";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const view = render(<OutboundAnalytics days={7} refresh={0} locale="ko" />);
    expect(fetcher).not.toHaveBeenCalled();
    auth.status = "authorized";
    fetcher.mockImplementation(() => response({}, 403));
    view.rerender(<OutboundAnalytics days={7} refresh={0} locale="ko" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("이 집계를 볼 권한이 없습니다.");
  });

  it("hides the previous owner's rows while the next request is pending", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => response(data)).mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<OutboundAnalytics days={7} refresh={0} locale="ko" />);
    await screen.findByText("wgrw.raceplan.co.kr");
    auth.email = "other@example.invalid";
    view.rerender(<OutboundAnalytics days={7} refresh={0} locale="ko" />);
    expect(screen.queryByText("wgrw.raceplan.co.kr")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
