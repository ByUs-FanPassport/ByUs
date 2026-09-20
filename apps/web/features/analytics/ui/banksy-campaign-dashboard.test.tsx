import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignAdminData } from "../domain/banksy-campaign";

const auth = vi.hoisted(() => ({ role: "admin", getAccessToken: vi.fn(async () => "admin-token") }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: auth.getAccessToken }) }));
vi.mock("../../../components/admin/use-admin-session", () => ({ useAdminSession: () => ({ status: "authorized", admin: { email: "admin@example.invalid", role: auth.role } }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/campaigns", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
import { BanksyCampaignContent, BanksyCampaignDashboard } from "./banksy-campaign-dashboard";

const linkId = "11111111-1111-4111-8111-111111111111";
const data: CampaignAdminData = {
  links: [{ id: linkId, creator: "elina", channel: "instagram", contentType: "story", name: "Launch story", locale: "ko", active: true, createdAt: "2026-09-20T01:00:00Z" }],
  report: {
    from: "2026-09-14T00:00:00Z", to: "2026-09-20T01:00:00Z",
    totals: { visits: 0, outboundSessions: 0 },
    sources: [{ linkId, visits: 4, outboundSessions: 1 }, { linkId: null, visits: 0, outboundSessions: 0 }],
    destinations: [{ destination: "exhibition", requests: 3, sessions: 2 }], legacyRequests: 7, mirrorworldLegacyRequests: 2,
  },
};

beforeEach(() => { auth.role = "admin"; auth.getAccessToken.mockReset().mockResolvedValue("admin-token"); });

describe("BanksyCampaignContent", () => {
  it("shows zero totals as an unavailable rate and attributes source performance by link", () => {
    render(<BanksyCampaignContent data={data} />);
    const analytics = screen.getByRole("region", { name: "캠페인 성과" });
    expect(within(analytics).getAllByText("—")).toHaveLength(2);
    const sourceRow = screen.getByRole("row", { name: /Launch story 4 1 25%/ });
    expect(sourceRow).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /링크 없음 \/ 직접 방문 0 0 —/ })).toBeInTheDocument();
    expect(screen.getByText(/반복 클릭은 요청 여러 건, 세션 한 건/)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders truthful empty tables", () => {
    render(<BanksyCampaignContent data={{ links: [], report: { ...data.report, sources: [], destinations: [], legacyRequests: 0 } }} locale="en" />);
    expect(screen.getByText("No share links have been created yet.")).toBeInTheDocument();
    expect(screen.getByText("No visits were recorded in this period.")).toBeInTheDocument();
    expect(screen.getByText("No outbound activity was recorded in this period.")).toBeInTheDocument();
  });
});

describe("BanksyCampaignDashboard", () => {
  it("keeps viewer access read-only", async () => {
    auth.role = "viewer";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    render(<BanksyCampaignDashboard />);
    expect(await screen.findAllByText("Launch story")).toHaveLength(2);
    expect(screen.getByText(/뷰어 권한/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "링크 생성" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
  });
});
