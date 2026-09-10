import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authenticated = false;
let ownerId = "owner-one";
let membershipCount = 3;
const getAccessToken = vi.fn();
const routerPush = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, getAccessToken, user: authenticated ? { id: ownerId } : null }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/c/kara",
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams("tab=home&locale=ko"),
}));
import { CelebrityFanPage } from "./celebrity-fan-page";

const kara = { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 0, fanCount: 12_800_000 } as const;
const katseye = { slug: "katseye", locale: "ko", name: "KATSEYE", summary: "KATSEYE summary", image: { url: "/images/celebrities/katseye/card.webp", alt: "KATSEYE portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 0, fanCount: 0 } as const;
const upcomingLive = { slug: "kara-nualeaf", celebritySlug: "kara", locale: "ko", title: "KARA × NUALEAF LIVE", startsAt: "2026-07-24T11:00:00.000Z", effectiveStatus: "scheduled" } as const;
const ownedPassport = {
  id: "8a6c0050-4c52-4e0f-b73a-e2f4aab48b85",
  owner: { nickname: "Jewel_KAT" },
  celebrity: {
    slug: "kara",
    name: "KARA",
    image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" },
  },
  businessStatus: "issued",
  mint: { status: "minted", txHash: `0x${"a".repeat(64)}`, tokenId: "1" },
  issuedAt: "2026-07-24T11:00:00.000Z",
  score: { points: 8, level: "Silver" },
  stampSummary: { knowledge: 1, reservation: 1, attendance: 1, survey: 0, total: 3 },
  display: { level: "실버", mintStatus: "발급 완료" },
} as const;

function currentCalendarMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", timeZone: "Asia/Seoul",
  }).format(new Date());
}

function adjacentTestMonth(month: string, offset: -1 | 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarPayload(events: unknown[] = [], month = currentCalendarMonth()) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return {
    month,
    timeZone: "Asia/Seoul",
    days: Array.from({ length: dayCount }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      return {
        date,
        events: events.filter((event) => String((event as { startsAt: string }).startsAt).slice(0, 10) === date),
      };
    }),
  };
}

function summaryPayload(passports: unknown[] = []) {
  return { summary: { profile: { nickname: "별빛팬" }, creators: passports.length ? [{ celebrity: { slug: "kara", name: "KARA", image: kara.image.url }, relationship: "passport", passport: { id: ownedPassport.id, tier: "Silver", score: 8, remainingToNextTier: 2 }, ticketBalance: 3, firstReaction: null }] : [], live: { upcoming: [], history: [] }, rewards: { availableCount: 0, entries: 0, items: [] }, collection: { passportCount: passports.length, stampCount: 0, collectibleCount: 0, recent: [] }, unreadNotificationCount: 0 } };
}
function stubHubFetch({ notices = [], passports = [], calendarEvents = [], raffles = [] }: { notices?: unknown[]; passports?: unknown[]; calendarEvents?: unknown[]; raffles?: unknown[] } = {}) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, json: async () => body });
    if (url.includes("/comments")) return ok({ total: 0, comments: [], nextCursor: null });
    if (url.includes("/notices")) return ok({ notices });
    if (url.includes("/raffles")) return ok({ raffles });
    if (url.includes("/api/me/summary")) return ok(summaryPayload(passports));
    if (url.includes("/api/me/avatar")) return { ok: false, json: async () => ({}) };
    if (url.includes("/fan-activity-visibility")) return ok({ enabled: false });
    if (url.includes("/fanpage")) return ok({ membershipCount, leaderboardAvailable: membershipCount > 500, activity: [] });
    if (url.includes("/leaderboard")) return membershipCount <= 500 ? { ok: false, json: async () => ({ error: { code: "LEADERBOARD_NOT_AVAILABLE" }, membershipCount }) } : ok({ membershipCount, available: true, asOf: "2026-09-08T00:00:00Z", rows: [{ rank: 1, nickname: "선두팬", avatarUrl: "/images/avatars/star-pink.webp", points: 12 }], me: null });
    if (url.includes("/api/live-events/calendar")) {
      const requestedMonth = new URL(url, "http://localhost").searchParams.get("month") ?? currentCalendarMonth();
      return ok(calendarPayload(calendarEvents, requestedMonth));
    }
    if (url.includes("/reactions")) return ok({ completed: false });
    return ok({});
  });
  vi.stubGlobal("fetch", request);
  return request;
}
describe("approved fanpage", () => {
  beforeEach(() => { authenticated = false; membershipCount = 3; ownerId = "owner-one"; getAccessToken.mockReset().mockResolvedValue("token"); routerPush.mockReset(); vi.unstubAllGlobals(); stubHubFetch(); });
  it("shows approved navigation and disables the leaderboard without trusting social followers", async () => {
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    const menu = screen.getByRole("navigation", { name: "KARA 팬페이지 메뉴" });
    expect(within(menu).getAllByRole("link").map((link) => link.textContent)).toEqual(["홈", "찐팬 인증", "래플 응모"]);
    expect(within(menu).getByRole("link", { name: "홈" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("button", { name: "리더보드" })).toBeDisabled();
    expect(within(menu).queryByText("집계 중")).not.toBeInTheDocument();
    expect(await screen.findByText("아직 등록된 공지가 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "인증 미션 보기" })).toHaveAttribute("href", "/c/kara?tab=certifications&locale=ko#celebrity-content");
    expect(screen.queryByText("12,800,000")).not.toBeInTheDocument();
  });
  it("opens the leaderboard link at 501 and renders only safe ranking fields", async () => {
    membershipCount = 501;
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} initialTab="leaderboard" />);
    expect(await screen.findByRole("link", { name: "리더보드" })).toHaveAttribute("href", "/c/kara?tab=leaderboard&locale=ko#celebrity-content");
    expect(await screen.findByText("선두팬")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("keeps direct leaderboard visits locked at 500 without a ranking table", async () => {
    membershipCount = 500;
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} initialTab="leaderboard" />);
    expect(await screen.findByText("현재 500명 / 501명")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("shows actual owned score, remaining points and nickname with one summary request", async () => {
    authenticated = true;
    const fetcher = stubHubFetch({ passports: [ownedPassport] });
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} />);
    expect(await screen.findByRole("link", { name: "내 패스포트" })).toHaveAttribute("href", `/passports/${ownedPassport.id}?locale=ko`);
    expect(screen.getByRole("progressbar", { name: "팬 등급 진행도" })).toHaveAttribute("value", "8");
    expect(screen.getByText("2점")).toBeInTheDocument();
    expect(screen.queryByText("87점")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/api/me/summary"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/api/passports"))).toHaveLength(0);
  });
  it("clears the previous owner's identity immediately during account changes", async () => {
    authenticated = true;
    stubHubFetch({ passports: [ownedPassport] });
    const view = render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} />);
    await screen.findByRole("link", { name: "내 패스포트" });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    ownerId = "owner-two";
    view.rerender(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} />);
    expect(screen.queryByText("별빛팬")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "내 패스포트" })).not.toBeInTheDocument();
  });
  it("shows one featured raffle and all raffle prizes only on the raffle tab", async () => {
    const raffle = { id: "22222222-2222-4222-8222-222222222222", benefitId: null, title: "전시 티켓", summary: "전시에서 함께해요.", imageUrl: null, winnerQuantity: 50, status: "preparing", entryOpensAt: null, entryClosesAt: null, fulfillmentMethod: "digital", perFanTicketLimit: null };
    stubHubFetch({ raffles: [raffle, { ...raffle, id: "33333333-3333-4333-8333-333333333333", title: "콜라보 케이스", winnerQuantity: 10 }] });
    const view = render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} />);
    await screen.findByText("전시 티켓");
    expect(screen.queryByText("콜라보 케이스")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "래플 자세히 보기" })).not.toBeInTheDocument();
    view.rerender(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} initialTab="raffles" />);
    expect(await screen.findByText("콜라보 케이스")).toBeInTheDocument();
    expect(screen.queryByText(/9월 25일/)).not.toBeInTheDocument();
  });
  it("keeps published notices and empty comments separate", async () => {
    stubHubFetch({ notices: [{ slug: "schedule", title: "LIVE 일정 안내", pinned: true, publishedAt: "2026-09-08T00:00:00Z" }] });
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={null} />);
    expect(await screen.findByText("LIVE 일정 안내")).toBeInTheDocument();
    expect(await screen.findByText("첫 댓글로 이야기를 시작해 보세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "댓글 전체 보기 →" })).toHaveAttribute("href", "/c/kara/notices/schedule?locale=ko#comments");
  });
  it("keeps official social channels and dedicated hero art direction", async () => {
    const links = [{ platform: "instagram" as const, url: "https://www.instagram.com/jen2jen2_/" }, { platform: "chzzk" as const, url: "https://chzzk.naver.com/channel" }];
    const { container } = render(<CelebrityFanPage celebrity={{ ...kara, slug: "jenny-jeong", socialLinks: links }} locale="ko" upcomingLive={null} />);
    expect(screen.getByRole("link", { name: "치지직, 새 창" })).toHaveAttribute("href", links[1]!.url);
    expect(screen.getByRole("link", { name: "Instagram, 새 창" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.querySelector('[data-dedicated-hero="jenny-jeong"]')).toBeInTheDocument();
    await screen.findByText("아직 등록된 공지가 없어요.");
  });
  it("preserves English labels and locale in actions", async () => {
    render(<CelebrityFanPage celebrity={{ ...kara, locale: "en" }} locale="en" upcomingLive={{ ...upcomingLive, locale: "en" }} />);
    expect(screen.getByRole("link", { name: "View verification missions" })).toHaveAttribute("href", "/c/kara?tab=certifications&locale=en#celebrity-content");
    expect(await screen.findByText("No notices yet.")).toBeInTheDocument();
  });
  it("shows only this celebrity's LIVE dates in the Hero mini calendar", async () => {
    const month = currentCalendarMonth();
    stubHubFetch({
      calendarEvents: [{
        id: "11111111-1111-4111-8111-111111111111",
        slug: "kara-calendar-live",
        startsAt: `${month}-12T11:00:00.000Z`,
        effectiveStatus: "live",
        title: "KARA 캘린더 LIVE",
        celebrity: { name: "KARA", image: "/images/guest-home/kara-card.jpg" },
        reservationState: null,
        hasBenefit: null,
      }, {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "changha-calendar-live",
        startsAt: `${month}-13T11:00:00.000Z`,
        effectiveStatus: "scheduled",
        title: "다른 셀럽 캘린더 LIVE",
        celebrity: { name: "Changha", image: "/images/guest-home/changha-card.jpg" },
        reservationState: null,
        hasBenefit: null,
      }],
    });

    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    expect(await screen.findByRole("button", { name: "12일, 1 LIVE" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "다가오는 일정" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /KARA 캘린더 LIVE/ })).toHaveLength(1);
    expect(screen.queryByLabelText(/다른 셀럽 캘린더 LIVE/)).not.toBeInTheDocument();
  });

  it("does not paint a multi-LIVE date with the first reservation state", async () => {
    const month = currentCalendarMonth();
    stubHubFetch({ calendarEvents: ["reserved", "not_reserved"].map((reservationState, index) => ({
      id: index === 0 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
      slug: index === 0 ? "kara-first-live" : "kara-second-live",
      startsAt: `${month}-12T${index === 0 ? "11" : "12"}:00:00.000Z`,
      effectiveStatus: "scheduled", title: index === 0 ? "첫 LIVE" : "두 번째 LIVE",
      celebrity: { name: "KARA", image: "/images/guest-home/kara-card.jpg" },
      reservationState, hasBenefit: null,
    })) });
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    const date = await screen.findByRole("button", { name: "12일, 2 LIVE" });
    expect(date).not.toHaveAttribute("href");
    expect(date).not.toHaveAttribute("data-reservation");
    expect(date).toHaveAttribute("data-upcoming", "true");
    fireEvent.click(date);
    expect(date).toHaveAttribute("aria-pressed", "true");
    const region = screen.getByRole("region", { name: "KARA LIVE 일정" });
    expect(within(region).getByRole("link", { name: /첫 LIVE/ })).toHaveAttribute("href", "/live/kara-first-live?locale=ko");
    expect(within(region).getByRole("link", { name: /두 번째 LIVE/ })).toHaveAttribute("href", "/live/kara-second-live?locale=ko");
    expect(within(region).getByText("예약 완료")).toBeInTheDocument();
    expect(within(region).getByText("예약 전")).toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "전체 보기" }));
    expect(date).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(date);
    fireEvent.click(date);
    expect(date).toHaveAttribute("aria-pressed", "false");
    expect(within(date).getByText("2")).toBeInTheDocument();

  });

  it("moves between mini-calendar months and refreshes the full-calendar destination", async () => {
    const request = stubHubFetch();
    const current = currentCalendarMonth();
    const nextMonth = adjacentTestMonth(current, 1);
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`다음 달:.*${Number(nextMonth.slice(5))}월`) }));

    expect(screen.getByRole("link", { name: "캘린더 크게 보기" })).toHaveAttribute(
      "href",
      `/live/calendar?month=${nextMonth}&locale=ko&celebrity=kara`,
    );
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      `/api/live-events/calendar?month=${nextMonth}&locale=ko`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it("loads personalized reservation state and distinguishes reserved LIVE dates", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    const month = currentCalendarMonth();
    const request = stubHubFetch({
      passports: [ownedPassport],
      calendarEvents: [{
        id: "33333333-3333-4333-8333-333333333333",
        slug: "kara-reserved-live",
        startsAt: `${month}-18T11:00:00.000Z`,
        effectiveStatus: "scheduled",
        title: "예약한 KARA LIVE",
        celebrity: { name: "KARA", image: "/images/guest-home/kara-card.jpg" },
        reservationState: "reserved",
        hasBenefit: false,
      }],
    });

    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    const reservedDate = await screen.findByRole("button", { name: "18일, 1 LIVE" });
    expect(reservedDate).not.toHaveAttribute("data-reservation");
    fireEvent.click(reservedDate);
    expect(within(screen.getByRole("region", { name: "KARA LIVE 일정" })).getByText("예약 완료")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      `/api/live-events/calendar?month=${month}&locale=ko`,
      expect.objectContaining({ headers: { Authorization: "Bearer token" } }),
    );
  });

  it("opens the nearest upcoming LIVE month instead of an empty current month", async () => {
    const request = stubHubFetch();
    const current = currentCalendarMonth();
    const nextMonth = adjacentTestMonth(current, 1);
    render(<CelebrityFanPage
      celebrity={kara}
      locale="ko"
      upcomingLive={{ ...upcomingLive, startsAt: `${nextMonth}-01T11:00:00.000Z` }}
    />);

    expect(screen.getByRole("link", { name: "캘린더 크게 보기" })).toHaveAttribute(
      "href",
      `/live/calendar?month=${nextMonth}&locale=ko&celebrity=kara`,
    );
    await waitFor(() => expect(request).toHaveBeenCalledWith(
      `/api/live-events/calendar?month=${nextMonth}&locale=ko`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it("uses one responsive art-directed KATSEYE hero image", () => {
    const { container } = render(
      <CelebrityFanPage celebrity={katseye} locale="ko" upcomingLive={null} />,
    );
    const picture = container.querySelector("picture");
    expect(picture?.querySelectorAll("img")).toHaveLength(1);
    expect(picture?.querySelector("source")).toHaveAttribute(
      "media",
      "(min-width: 48rem)",
    );
    expect(screen.getByAltText("KATSEYE portrait")).toBeInTheDocument();
  });


});
