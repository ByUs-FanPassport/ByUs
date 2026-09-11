import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebAnalyticsData } from "../domain/web-analytics";

const auth = vi.hoisted(() => ({ status: "authorized", email: "admin@example.invalid", getAccessToken: vi.fn(async (): Promise<string | null> => "admin-token") }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: auth.getAccessToken }) }));
vi.mock("../../../components/admin/use-admin-session", () => ({ useAdminSession: () => ({ status: auth.status, admin: { email: auth.email, role: "admin" } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/traffic", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
import { WebAnalyticsContent, WebAnalyticsDashboard } from "./web-analytics-dashboard";

const data: WebAnalyticsData = {
  days: 7, from: "2026-09-05T00:00:00Z", to: "2026-09-12T00:00:00Z", fetchedAt: "2026-09-11T23:00:00Z",
  totals: { visitors: 358, pageviews: 1386 }, trend: [{ date: "2026-09-11", visitors: 358, pageviews: 1386 }],
  breakdowns: {
    pages: [{ label: "/pages/elina-fan-guide", visitors: 252, pageviews: 400 }],
    referrers: [{ label: "l.instagram.com", visitors: 233, pageviews: 600 }],
    countries: [{ label: "KR", visitors: 43, pageviews: 86 }], devices: [{ label: "mobile", visitors: 337, pageviews: 1200 }],
    browsers: [], operatingSystems: [],
  },
};
const response = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status }));
beforeEach(() => { auth.status = "authorized"; auth.email = "admin@example.invalid"; auth.getAccessToken.mockReset().mockResolvedValue("admin-token"); });

describe("WebAnalyticsContent", () => {
  it("switches the trend metric and keeps source values and member distinction visible", () => {
    render(<WebAnalyticsContent data={data} />);
    expect(screen.getByRole("img", { name: /^방문자/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /페이지뷰/ }));
    expect(screen.getByRole("img", { name: /^페이지뷰/ })).toBeInTheDocument();
    expect(screen.getByText("대한민국")).toBeInTheDocument();
    expect(screen.getByText("모바일")).toBeInTheDocument();
    expect(screen.getByText(/회원 수·활동 회원 수와는 다릅니다/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "인기 페이지" })).getByText("252")).toBeInTheDocument();
  });
  it("renders English labels and a truthful empty state", () => {
    render(<WebAnalyticsContent data={data} locale="en" />);
    expect(screen.getByRole("region", { name: "Operating systems" })).toHaveTextContent("No visits recorded");
    expect(screen.getByText("South Korea")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Visitors/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("WebAnalyticsDashboard", () => {
  it("requests authenticated analytics and applies the selected period", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => response({ ...data, days: url.includes("days=30") ? 30 : 7 }));
    vi.stubGlobal("fetch", fetcher);
    render(<WebAnalyticsDashboard />);
    await screen.findByText("/pages/elina-fan-guide");
    expect(fetcher).toHaveBeenCalledWith("/api/admin/analytics/web?days=7", expect.objectContaining({ headers: { authorization: "Bearer admin-token" }, cache: "no-store" }));
    fireEvent.click(screen.getByRole("button", { name: "최근 30일" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/analytics/web?days=30", expect.anything()));
    await screen.findByText("/pages/elina-fan-guide");
  });
  it("never requests analytics when admin access is denied", () => {
    auth.status = "denied";
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<WebAnalyticsDashboard />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByText("/pages/elina-fan-guide")).not.toBeInTheDocument();
  });
  it("handles expired tokens without fetching and does not show data after access revocation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(data)));
    const view = render(<WebAnalyticsDashboard />);
    await screen.findByText("/pages/elina-fan-guide");
    auth.status = "denied"; view.rerender(<WebAnalyticsDashboard />);
    expect(screen.queryByText("/pages/elina-fan-guide")).not.toBeInTheDocument();
    auth.status = "authorized"; auth.getAccessToken.mockResolvedValue(null);
    view.rerender(<WebAnalyticsDashboard />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByText("/pages/elina-fan-guide")).not.toBeInTheDocument();
  });
  it("shows an error instead of fabricated zeros and recovers on retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => response({ error: { code: "WEB_ANALYTICS_UNAVAILABLE" } }, 503)).mockImplementation(() => response(data)));
    render(<WebAnalyticsDashboard />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("img", { name: /^방문자/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText("/pages/elina-fan-guide");
  });
  it("hides previous account data immediately while the next account request is pending", async () => {
    const fetcher = vi.fn().mockImplementationOnce(() => response(data)).mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<WebAnalyticsDashboard />);
    await screen.findByText("/pages/elina-fan-guide");
    auth.email = "other@example.invalid";
    view.rerender(<WebAnalyticsDashboard />);
    expect(screen.queryByText("/pages/elina-fan-guide")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
