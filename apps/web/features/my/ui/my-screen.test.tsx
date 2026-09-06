import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyScreen } from "./my-screen";
import { notifyFanActivityUpdated } from "../../../components/fan-ui/fan-activity-updates";

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
  it("adds a newly recorded first-reaction relationship after the shared update without remounting", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ summary: { ...summary, creators: [] } }))
      .mockResolvedValueOnce(Response.json({ summary: { ...summary, creators: [{ ...summary.creators[0], relationship: "first_reaction_only", passport: null }] } }));
    vi.stubGlobal("fetch", fetcher);
    render(<MyScreen locale="ko" />);
    expect(await screen.findByText("아직 등록한 최애가 없어요.")).toBeInTheDocument();
    await act(async () => { notifyFanActivityUpdated(undefined); });
    expect(await screen.findByText("첫 반응")).toBeInTheDocument();
    expect(screen.getByText("첫 반응").closest("a")).toHaveAttribute("href", "/c/kara?locale=ko");
  });
  it("prioritizes profile identity, activity totals, and the four owner activity sections", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByRole("heading", { name: "카밀리아님", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("최애와 함께한 기록을 한눈에 모았어요.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "활동 요약" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 최애" })).toBeInTheDocument();
    expect(screen.getByText("실버 · 팬 점수 15 · 골드까지 팬 점수 35점")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "다가오는 LIVE" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "받은 혜택" })).toBeInTheDocument();
    expect(screen.getByText("수령 완료")).toBeInTheDocument();
    expect(screen.getAllByText("응모권").length).toBeGreaterThan(0);
    expect(screen.getByText("응모")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^1\s*내 최애$/ })).toHaveAttribute("href", "#my-creators");
    expect(screen.getByRole("link", { name: /^1\s*내 패스포트$/ })).toHaveAttribute("href", "/passports?locale=ko");
    expect(screen.getByRole("link", { name: /^2\s*스탬프$/ })).toHaveAttribute("href", "/passports?locale=ko#collection");
    expect(screen.getByRole("link", { name: /^4\s*응모권$/ })).toHaveAttribute("href", "#my-creators");
    expect(screen.queryByRole("link", { name: /^0\s*디지털 기념품$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("pickup_completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "최근 활동" })).not.toBeInTheDocument();
    const settings = screen.getByRole("link", { name:"알림 설정" });
    expect(settings).toHaveAttribute("href", "/settings?locale=ko");
    expect(settings.closest("header")).toContainElement(screen.getByRole("link", { name:/새 알림/ }));
    expect(screen.getAllByRole("link", { name:"알림 설정" })).toHaveLength(1);
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
    expect(screen.queryByText("예약한 LIVE가 없어요.")).not.toBeInTheDocument();
    expect(screen.queryByText("아직 받은 혜택이 없어요.")).not.toBeInTheDocument();
    expect(screen.queryByText("아직 수집한 기록이 없어요.")).not.toBeInTheDocument();
  });

  it("distinguishes unspent Raffle tickets from completed Entries in English", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary })));
    render(<MyScreen locale="en" />);

    expect(await screen.findByText("Entries")).toBeInTheDocument();
    expect(screen.getAllByText("Raffle tickets").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /^4\s*Raffle tickets$/ })).toHaveAttribute("href", "#my-creators");
  });
});

it("places reserved LIVE before owned records and compact totals", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: { ...summary, live: { upcoming: [{ id, slug:"reserved-live", title:"내 예약 LIVE", startsAt:"2026-09-06T00:00:00.000Z", effectiveStatus:"scheduled", attended:false }], history:[] } } })));
  render(<MyScreen locale="ko"/>);
  const event=await screen.findByText("내 예약 LIVE");
  expect(event.compareDocumentPosition(screen.getByRole("heading",{name:"내 최애"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(event.compareDocumentPosition(screen.getByRole("heading",{name:"활동 요약"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});


it("shows a date-led reserved event and moves recent records into the supporting column", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: {
    ...summary,
    live: { upcoming: [{ id, slug:"reserved-live", title:"내 예약 LIVE", startsAt:"2026-09-18T11:30:00.000Z", effectiveStatus:"scheduled", attended:false }], history:[] },
    rewards: { availableCount:0, entries:0, items:[] },
    collection: { ...summary.collection, recent:[{ id, kind:"stamp", title:"KARA Stamp", occurredAt:"2026-09-01T00:00:00.000Z", href:`/passports/${id}` }] },
  } })));
  const {container} = render(<MyScreen locale="ko"/>);
  await screen.findByText("내 예약 LIVE");
  expect(container.querySelector('time[datetime="2026-09-18T11:30:00.000Z"]')).toHaveTextContent("9월18");
  expect(screen.getByText("KARA Stamp").closest("aside")).not.toBeNull();
  expect(container.querySelector('[data-has-rail="true"]')).not.toBeNull();
  expect(screen.getByText("KARA").closest("a")?.querySelector("img")).toHaveAttribute("src", expect.stringContaining("%2Fkara.jpg"));
});

it("links the collectible total only when a real recent collectible supplies a destination", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: {
    ...summary,
    collection: {
      passportCount: 1,
      stampCount: 2,
      collectibleCount: 1,
      recent: [{ id: benefitId, kind: "collectible", title: "KARA 디지털 기념품", occurredAt: "2026-09-01T00:00:00.000Z", href: `/passports/${id}` }],
    },
  } })));
  render(<MyScreen locale="ko"/>);

  expect(await screen.findByRole("link", { name: /^1\s*디지털 기념품$/ })).toHaveAttribute("href", "#my-collection");
  expect(document.querySelector("#my-collection")).toHaveTextContent("KARA 디지털 기념품");
});
