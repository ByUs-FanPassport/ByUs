import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOverviewData } from "../domain/admin-overview";
const auth = vi.hoisted(() => ({ session: "authorized", email: "admin@example.invalid", getAccessToken: vi.fn(async () => "token") }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: auth.getAccessToken }) }));
vi.mock("../../../components/admin/use-admin-session", () => ({ useAdminSession: () => ({ status: auth.session, admin: { email: auth.email, role: "admin" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
import { AdminOverviewContent, AdminOverviewDashboard } from "./admin-overview-dashboard";
const payload: AdminOverviewData = {
  asOf: "2026-09-11T08:00:00Z", from: "2026-08-12T15:00:00Z", previousFrom: "2026-07-14T22:00:00Z", days: 30,
  members: { total: 1200, signups: { current: 12, previous: 0 }, week: { current: 5, previous: 2 }, month: { current: 12, previous: 0 } },
  activity: { daily: 2, monthly: 10, measuredSince: "2026-09-01T00:00:00Z" },
  trend: [{ date: "2026-09-10", signups: 0 }, { date: "2026-09-11", signups: 12 }],
  usage: { passports: 0, reactions: 0, reservations: 0, attendances: 0, entries: 0 },
  content: { creators: 2, scheduled: 0, live: 0, ended: 1, cancelled: 0, drafts: 2 },
  issues: { certifications: 3, failedJobs: 0, failedNotifications: 1 }, upcoming: [],
};
beforeEach(() => { auth.session = "authorized"; auth.email = "admin@example.invalid"; vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }))); });
describe("admin business overview", () => {
  it("shows members, zero activity and direct pending-work links without invented percentages", () => {
    render(<AdminOverviewContent data={payload} />);
    expect(screen.getByRole("heading", { name: "총 가입자" }).parentElement).toHaveTextContent("1,200");
    expect(screen.getAllByText("이전 0명 · 증감률 없음").length).toBe(2);
    expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /심사 대기/ })).toHaveAttribute("href", "/admin/certifications");
    expect(screen.getByText("이 기간에 기록된 이용 내역이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("진행 중이거나 예정된 공개 LIVE가 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "주간" }));
    expect(screen.getByRole("button", { name: "주간" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: /신규 가입자/ })).toBeInTheDocument();
  });
  it("fetches real schema payload and applies the requested range", async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ ...payload, days: url.includes("days=7") ? 7 : 30 }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<AdminOverviewDashboard />);
    expect(await screen.findByRole("heading", { name: "총 가입자" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "최근 7일" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith("/api/admin/analytics/overview?days=7", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) })));
    expect(await screen.findByText("최근 7일 · 오늘 포함")).toBeInTheDocument();
  });
  it("renders a retryable error instead of numeric zero on failed reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    render(<AdminOverviewDashboard />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "총 가입자" })).not.toBeInTheDocument();
  });
  it("does not request data for an unauthorized session", () => {
    auth.session = "unauthenticated";
    render(<AdminOverviewDashboard />);
    expect(screen.getByRole("heading", { name: "관리자 로그인이 필요합니다" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("hides prior-member data while a different account reloads", async () => {
    const view = render(<AdminOverviewDashboard />);
    await screen.findByRole("heading", { name: "총 가입자" });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    auth.email = "another@example.invalid";
    view.rerender(<AdminOverviewDashboard />);
    expect(screen.queryByRole("heading", { name: "총 가입자" })).not.toBeInTheDocument();
  });
});
