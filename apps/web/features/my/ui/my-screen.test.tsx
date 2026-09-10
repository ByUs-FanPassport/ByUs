import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const { avatarOwner } = vi.hoisted(() => ({ avatarOwner: { id: undefined as string | undefined } }));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: avatarOwner.id ? { id: avatarOwner.id } : undefined, getAccessToken }),
}));

afterEach(() => { avatarOwner.id = undefined; vi.useRealTimers(); });

describe("unified MY hub", () => {
  it("renders the same catalog avatar in the profile header and links it to settings", async () => {
    avatarOwner.id = "owner-a";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/me/avatar")
        ? Response.json({ avatar: { initialCharacterId: "star-cream", characterId: "fairy-pink", source: "character", hasImage: false, revision: 1 } })
        : Response.json({ summary }),
    ));
    render(<MyScreen locale="ko" />);

    const link = await screen.findByRole("link", { name: "프로필 수정" });
    expect(link).toHaveAttribute("href", "/settings?locale=ko");
    expect(link.querySelector("img")).toHaveAttribute("src", "/images/avatars/fairy-pink.webp");
    expect(link).not.toHaveTextContent("카");
  });

  it("renders a first-reaction favorite without manufacturing a fan tier", async () => {
    avatarOwner.id = "owner-a";
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/me/summary")) return Response.json({ summary: { ...summary, creators: [{ ...summary.creators[0], relationship: "first_reaction_only", passport: null }] } });
      if (url.startsWith("/api/me/avatar")) return Response.json({ avatar: null });
      return Response.json({ certifications: [], raffles: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<MyScreen locale="ko" />);
    expect(await screen.findByText(/첫 반응/)).toBeInTheDocument();
    expect(screen.getByText(/첫 반응/).closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("link", { name: "팬 인증 시작하기" })[0]).toHaveAttribute("href", "/c/kara?tab=certifications&locale=ko#celebrity-content");
  });
  it("prioritizes profile identity, activity totals, and the four owner activity sections", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary })));
    render(<MyScreen locale="ko" />);

    expect(await screen.findByRole("heading", { name: "카밀리아님", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("최애와 함께한 기록을 한눈에 모았어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "KARA · 실버" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /KARA실버/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "활동 요약" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 최애" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "다음 팬등급 진행률" })).toHaveAttribute("value", "30");
    expect(screen.getByText("골드까지 35점")).toBeInTheDocument();
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
    const settings = screen.getByRole("link", { name:"설정" });
    expect(settings).toHaveAttribute("href", "/settings?locale=ko");
    expect(settings.closest("header")).toContainElement(screen.getByRole("link", { name:/새 알림/ }));
    expect(screen.getAllByRole("link", { name:"설정" })).toHaveLength(1);
  });

  it("follows the selected favorite and trusts its server stage label, segment, and artwork", async () => {
    const stageProgress = {
      policyVersion: 2,
      current: { key: "gold-2", tier: "Gold", subdivision: 2, rank: 5, minimumScore: 70 },
      next: { key: "gold-3", tier: "Gold", subdivision: 3, rank: 6, minimumScore: 95 },
      remaining: 15,
      progressPercent: 40,
    } as const;
    const second = {
      ...summary.creators[0],
      celebrity: { slug: "elina", name: "Elina", image: "/elina.jpg" },
      passport: { ...summary.creators[0].passport, id: "66666666-6666-4666-8666-666666666666", tier: "Gold", score: 80, remainingToNextTier: 40, stageProgress },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/me/summary")) return Response.json({ summary: { ...summary, creators: [summary.creators[0], second] } });
      if (url.startsWith("/api/me/avatar")) return Response.json({ avatar: null });
      if (url.includes("certifications")) return Response.json({ certifications: [] });
      return Response.json({ raffles: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<MyScreen locale="ko" />);

    fireEvent.click(await screen.findByRole("button", { name: /Elina골드 2/ }));
    expect(screen.getByText("골드 2", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("골드 3까지 15점")).toBeInTheDocument();
    expect(screen.getByText("플래티넘 등급까지 40점")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "다음 팬등급 진행률" })).toHaveAttribute("value", "40");
    expect([...container.querySelectorAll("img")].some((image) => decodeURIComponent(image.src).includes("/opal-heart/256/gold-2.png"))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/me/summary?locale=ko&tierStages=1")).toBe(true);
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

  it("links an information-required reward to its localized recipient route", async () => {
    const actionable = {
      ...summary.rewards.items[0],
      status: "information_required",
      recipientRequired: true,
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      summary: { ...summary, rewards: { ...summary.rewards, items: [actionable] } },
    })));
    render(<MyScreen locale="en" />);

    const link = await screen.findByRole("link", { name: /Enter recipient details/ });
    expect(link).toHaveAttribute("href", `/my/rewards/${actionable.winnerId}/recipient?locale=en`);
    expect(actionable.benefitHref).toBe(`/benefits/${benefitId}`);
  });

  it("refetches a preparing raffle at its opening boundary after unrelated resources rerender", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-10T00:00:00Z");
    avatarOwner.id = "owner-a";
    let raffleReads = 0;
    const preparingCreator = { ...summary.creators[0], relationship: "first_reaction_only", passport: null };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/me/summary")) return Response.json({ summary: { ...summary, creators: [preparingCreator] } });
      if (url.startsWith("/api/me/avatar")) return Response.json({ avatar: null });
      if (url.includes("/raffles?")) {
        raffleReads += 1;
        return Response.json({ raffles: [{ id: "60000000-0000-4000-8000-000000000001", benefitId, title: "오픈 경계 래플", summary: "곧 열려요", imageUrl: null, winnerQuantity: 1, status: raffleReads === 1 ? "preparing" : "open", entryOpensAt: "2026-09-10T00:00:01Z", entryClosesAt: "2026-09-10T01:00:00Z", fulfillmentMethod: "digital", perFanTicketLimit: null }] });
      }
      if (url.includes("/certifications?")) return await new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ certifications: [] })), 500));
      return Response.json({ certifications: [] });
    }));
    render(<MyScreen locale="ko"/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(raffleReads).toBe(1);
    expect(screen.queryByRole("link", { name: "래플 자세히 보기" })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(raffleReads).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    expect(raffleReads).toBe(2);
    expect(screen.getByRole("link", { name: "래플 자세히 보기" })).toHaveAttribute("href", `/benefits/${benefitId}?locale=ko`);
  });
});

it("places the selected favorite panels before LIVE and compact totals after owned records", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: { ...summary, live: { upcoming: [{ id, slug:"reserved-live", title:"내 예약 LIVE", startsAt:"2026-09-06T00:00:00.000Z", effectiveStatus:"scheduled", attended:false }], history:[] } } })));
  render(<MyScreen locale="ko"/>);
  const event=await screen.findByText("내 예약 LIVE");
  expect(screen.getByRole("heading",{name:"내 최애"}).compareDocumentPosition(event) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(event.compareDocumentPosition(screen.getByRole("heading",{name:"활동 요약"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});


it("shows a date-led reserved event and keeps recent records below favorites in the main column", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: {
    ...summary,
    live: { upcoming: [{ id, slug:"reserved-live", title:"내 예약 LIVE", startsAt:"2026-09-18T11:30:00.000Z", effectiveStatus:"scheduled", attended:false }], history:[] },
    rewards: { availableCount:0, entries:0, items:[] },
    collection: { ...summary.collection, recent:[{ id, kind:"stamp", title:"KARA Stamp", occurredAt:"2026-09-01T00:00:00.000Z", href:`/passports/${id}` }] },
  } })));
  const {container} = render(<MyScreen locale="ko"/>);
  await screen.findByText("내 예약 LIVE");
  expect(container.querySelector('time[datetime="2026-09-18T11:30:00.000Z"]')).toHaveTextContent("9월18");
  expect(screen.getByText("KARA Stamp").closest("aside")).toBeNull();
  expect(container.querySelector("#my-creators")!.compareDocumentPosition(container.querySelector("#my-collection")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector("#my-collection")!.parentElement?.className).toContain("lowerGrid");
  expect(within(container.querySelector("#my-creators")!).getByText("KARA").closest("button")?.querySelector("img")).toHaveAttribute("src", expect.stringContaining("%2Fkara.jpg"));
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
  expect(screen.getByText("KARA 디지털 기념품")).toBeVisible();
  const scroll = vi.fn();
  document.querySelector("#my-collection")!.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("link", { name: /^1\s*디지털 기념품$/ }));
  expect(screen.getByText("KARA 디지털 기념품")).toBeVisible();
  await waitFor(() => expect(scroll).toHaveBeenCalled());
  expect(document.activeElement).toBe(document.querySelector("#my-collection"));
});

it("keeps all twelve recent items accessible inside the disclosure and follows its fragment", async () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({ id: `11111111-1111-4111-8111-${String(index).padStart(12,"0")}`, kind:"stamp", title:`팬 활동 ${index + 1}`, occurredAt:"2026-09-01T00:00:00.000Z", href:`/passports/${id}` }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ summary: { ...summary, collection: { ...summary.collection, recent } } })));
  render(<MyScreen locale="ko"/>);
  await screen.findByRole("heading",{name:"카밀리아님"});
  expect(screen.getByText("팬 활동 1")).toBeVisible();
  expect(screen.getByText("팬 활동 3")).toBeVisible();
  expect(screen.getByText("팬 활동 4")).not.toBeVisible();
  expect(screen.getByText("팬 활동 12")).not.toBeVisible();
  const collection = document.querySelector("#my-collection")!;
  collection.scrollIntoView = vi.fn();
  await act(async () => {
    window.history.replaceState(null,"","#my-collection");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(screen.getByText("팬 활동 12")).toBeVisible();
  await waitFor(() => expect(document.activeElement).toBe(collection));
  window.history.replaceState(null,"","/my");
});
