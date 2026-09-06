import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let authenticated = false;
const getAccessToken = vi.fn();
const routerPush = vi.fn();
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated, getAccessToken }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/c/kara",
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams("tab=home&locale=ko"),
}));
import { CelebrityFanPage } from "./celebrity-fan-page";

const kara = { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 0, fanCount: 12_800_000 } as const;
const changha = { slug: "changha", locale: "ko", name: "Changha", summary: "Changha summary", image: { url: "/images/guest-home/changha-card.jpg", alt: "Changha portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 1, fanCount: 1_450_000 } as const;
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

function stubHubFetch({
  notices = [],
  benefits = [],
  passports = [],
  calendarEvents = [],
}: {
  notices?: unknown[];
  benefits?: unknown[];
  passports?: unknown[];
  calendarEvents?: unknown[];
} = {}) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/notices")) {
      return { ok: true, json: async () => ({ notices }) };
    }
    if (url.includes("/api/benefits")) {
      return { ok: true, json: async () => ({ benefits }) };
    }
    if (url.includes("/api/passports")) {
      return { ok: true, json: async () => ({ passports }) };
    }
    if (url.includes("/api/live-events/calendar")) {
      const requestedMonth = new URL(url, "http://localhost").searchParams.get("month") ?? currentCalendarMonth();
      return { ok: true, json: async () => calendarPayload(calendarEvents, requestedMonth) };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", request);
  return request;
}

describe("published celebrity fan page", () => {
  beforeEach(() => {
    authenticated = false;
    getAccessToken.mockReset();
    routerPush.mockReset();
    vi.unstubAllGlobals();
    stubHubFetch();
  });

  it("renders the four-tab editorial hub without a decorative empty Passport", async () => {
    const { container } = render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    expect(screen.getAllByRole("link", { name: "ByUs 홈" })[0]).toHaveAttribute("href", "/?locale=ko");
    expect(screen.getByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "KARA 팬페이지 메뉴" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["홈", "공지", "LIVE", "혜택"]);
    expect(screen.getByRole("tab", { name: "홈" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "좋아요 남기기" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /좋아요 남기기/ })).toBeInTheDocument();
    expect(screen.queryByText(/Reaction|반응/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "KARA 프로필" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "새 소식" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "다가오는 LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "팬 혜택" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "내 패스포트" })).toBeInTheDocument();
    expect(screen.getByText("LIVE 예정")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LIVE 정보 보기" })).toHaveAttribute("href", "/live/kara-nualeaf?locale=ko");
    expect(screen.getByRole("link", { name: /팬 인증하기/ }))
      .toHaveAttribute("href", expect.stringContaining("intent=passport"));
    expect(screen.getByRole("link", { name: /팬 인증하기/ }))
      .toHaveAttribute("data-fan-action-emphasis", "primary");
    expect(document.querySelectorAll('main [data-fan-action-emphasis="primary"]')).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "KARA LIVE 일정" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "캘린더 크게 보기" })).toHaveAttribute(
      "href",
      `/live/calendar?month=${currentCalendarMonth()}&locale=ko&celebrity=kara`,
    );
    expect(screen.queryByAltText("모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport")).not.toBeInTheDocument();
    expect(await screen.findByText("아직 새로운 소식이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "소식 전체 보기" })).not.toBeInTheDocument();
    expect(container.querySelector("p [data-fan-motion]")).not.toBeInTheDocument();
  });

  it("places exactly one calendar after upcoming LIVE in the Home content, outside the hero", async () => {
    const { container } = render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    const calendar = screen.getByRole("region", { name: "KARA LIVE 일정" });
    expect(screen.getAllByRole("region", { name: "KARA LIVE 일정" })).toHaveLength(1);
    expect(calendar.closest('[data-celebrity-calendar-placement="content"]')).not.toBeNull();
    expect(calendar.closest('[role="tabpanel"]')).toHaveAttribute("id", "celebrity-home-panel");
    const nextLive = screen.getByRole("heading", { name: "다가오는 LIVE" });
    const benefits = screen.getByRole("heading", { name: "팬 혜택" });
    expect(nextLive.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calendar.compareDocumentPosition(benefits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('section[aria-labelledby="celebrity-heading"]')?.contains(calendar)).toBe(false);
    await screen.findByText("아직 새로운 소식이 없어요.");
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
    expect(within(region).getByText("미예약")).toBeInTheDocument();
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

  it("renders honest Home empty states for missing public hub data", async () => {
    render(<CelebrityFanPage celebrity={changha} locale="ko" upcomingLive={null} />);
    expect(screen.getByText("공개된 LIVE가 아직 없어요.")).toBeInTheDocument();
    expect(screen.getByText("아직 등록된 공식 채널이 없어요.")).toBeInTheDocument();
    expect(await screen.findByText("아직 새로운 소식이 없어요.")).toBeInTheDocument();
    expect(await screen.findByText("아직 받을 수 있는 혜택이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /LIVE 정보 보기/ })).not.toBeInTheDocument();
  });

  it("limits Home previews while reusing the Notice and Benefit data requests", async () => {
    const request = stubHubFetch({
      notices: [
        { slug: "pinned", title: "고정 공지", pinned: true, publishedAt: "2026-07-25T10:00:00.000Z" },
        { slug: "latest", title: "새로운 공지", pinned: false, publishedAt: "2026-07-24T10:00:00.000Z" },
        { slug: "older", title: "이전 공지", pinned: false, publishedAt: "2026-07-23T10:00:00.000Z" },
      ],
      benefits: [
        { id: "benefit-1", title: "첫 혜택", summary: "첫 설명", eligibilityLabel: "팬 인증", state: "eligible" },
        { id: "benefit-2", title: "두 번째 혜택", summary: "두 번째 설명", eligibilityLabel: "5점", state: "locked" },
        { id: "benefit-3", title: "세 번째 혜택", summary: "세 번째 설명", eligibilityLabel: "10점", state: "locked" },
      ],
    });

    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    expect(await screen.findByRole("link", { name: /고정 공지/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /새로운 공지/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /이전 공지/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "첫 혜택" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "두 번째 혜택" })).toBeInTheDocument();
    expect(screen.getByText("수령 가능")).toBeInTheDocument();
    expect(screen.getByText("잠김")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "세 번째 혜택" })).not.toBeInTheDocument();
    expect(request.mock.calls.filter(([input]) => String(input).includes("/notices"))).toHaveLength(1);
    expect(request.mock.calls.filter(([input]) => String(input).includes("/api/benefits"))).toHaveLength(1);
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

  it("loads the selected Notice tab and keeps locale in detail links", async () => {
    stubHubFetch({
      notices: [{ slug: "opening", title: "공식 오픈 안내", pinned: true, publishedAt: "2026-07-25T10:00:00.000Z" }],
    });
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} initialTab="notice" />);
    expect(screen.getByRole("tab", { name: "공지" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ByUs가 전하는 KARA 소식을 확인하세요.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /공식 오픈 안내/ })).toHaveAttribute("href", "/c/kara/notices/opening?locale=ko");
  });

  it("flattens the grouped LIVE catalog before filtering by celebrity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        catalog: {
          liveNow: [],
          upcoming: [{
            live: {
              slug: "kara-upcoming",
              title: "KARA 다음 LIVE",
              startsAt: "2026-08-24T11:00:00.000Z",
              effectiveStatus: "scheduled",
              celebrity: { slug: "kara" },
            },
          }, {
            live: {
              slug: "changha-upcoming",
              title: "다른 셀럽 LIVE",
              startsAt: "2026-08-25T11:00:00.000Z",
              effectiveStatus: "scheduled",
              celebrity: { slug: "changha" },
            },
          }],
          replay: [],
        },
      }),
    }));

    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} initialTab="live" />);

    expect(await screen.findByRole("heading", { name: "KARA 다음 LIVE" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "다른 셀럽 LIVE" })).not.toBeInTheDocument();
  });

  it("moves between URL-backed tabs with arrow keys", () => {
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    const homeTab = screen.getByRole("tab", { name: "홈" });
    const noticeTab = screen.getByRole("tab", { name: "공지" });
    expect(noticeTab).toHaveAttribute("href", "/c/kara?tab=notice&locale=ko#celebrity-content");
    expect(document.getElementById("celebrity-content")).toBeInTheDocument();
    fireEvent.keyDown(homeTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(noticeTab);
    expect(routerPush).toHaveBeenCalledWith("/c/kara?tab=notice&locale=ko#celebrity-content");
    fireEvent.keyDown(homeTab, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "혜택" }));
    expect(routerPush).toHaveBeenLastCalledWith("/c/kara?tab=benefits&locale=ko#celebrity-content");
  });

  it.each([
    ["home", "celebrity-home-panel"],
    ["notice", "celebrity-notice-panel"],
    ["live", "celebrity-live-panel"],
    ["benefits", "celebrity-benefits-panel"],
  ] as const)("renders one mini calendar in the active %s tab", async (initialTab, panelId) => {
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} initialTab={initialTab} />);
    const calendars = screen.getAllByRole("region", { name: "KARA LIVE 일정" });
    expect(calendars).toHaveLength(1);
    expect(calendars[0]?.closest('[role="tabpanel"]')).toHaveAttribute("id", panelId);
    await screen.findByRole("heading", { name: "다가오는 일정" });
  });

  it("renders only supplied official SNS links with accessible external-link names", () => {
    render(<CelebrityFanPage celebrity={{ ...kara, socialLinks: [{ platform: "youtube", url: "https://www.youtube.com/@official" }] }} locale="ko" upcomingLive={upcomingLive} />);
    expect(screen.getByRole("link", { name: "YouTube 열기: KARA, 새 창" })).toHaveAttribute("href", "https://www.youtube.com/@official");
    expect(screen.queryByText("공개된 SNS 링크가 아직 없어요.")).not.toBeInTheDocument();
  });

  it("connects the fan shell skip link to the celebrity detail and labels LIVE actions by target", () => {
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    expect(screen.getByRole("link", { name: "본문으로 바로가기" })).toHaveAttribute(
      "href",
      "#celebrity-detail-main",
    );
    expect(document.querySelector("main")).toHaveAttribute("id", "celebrity-detail-main");
    expect(
      screen.getByRole("link", { name: "LIVE 정보 보기" }),
    ).toHaveAttribute("href", "/live/kara-nualeaf?locale=ko");
  });

  it("switches the Hero primary and compact Passport link as soon as ownership resolves", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    stubHubFetch({ passports: [ownedPassport] });
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveAttribute(
      "href",
      "/passports/8a6c0050-4c52-4e0f-b73a-e2f4aab48b85?locale=ko",
    ));
    expect(screen.getByRole("link", { name: "Passport 열기" }))
      .toHaveAttribute("data-fan-action-emphasis", "primary");
    expect(document.querySelectorAll('main [data-fan-action-emphasis="primary"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "패스포트 자세히 보기" })).toHaveAttribute(
      "href",
      "/passports/8a6c0050-4c52-4e0f-b73a-e2f4aab48b85?locale=ko",
    );
    expect(screen.getByText("실버")).toBeInTheDocument();
    expect(screen.getByText("8", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /팬 인증하기/ })).not.toBeInTheDocument();
  });

  it("gives the Bronze passport tier a non-color medal cue", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    const bronzePassport = {
      ...ownedPassport,
      score: { ...ownedPassport.score, level: "Bronze" },
      display: { ...ownedPassport.display, level: "브론즈" },
    };
    stubHubFetch({ passports: [bronzePassport] });

    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    const tier = await screen.findByText("브론즈");
    expect(tier.closest("div")).toHaveAttribute("data-passport-tier", "bronze");
    expect(document.querySelector('[data-tier-medal="bronze"]')).toBeInTheDocument();
  });

  it("starts fan verification directly for an authenticated non-holder without opening login", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    stubHubFetch({ passports: [] });
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);

    const action = await screen.findByRole("link", { name: /팬 인증하기/ });
    fireEvent.click(action);

    expect(routerPush).toHaveBeenCalledWith(
      "/c/kara/verify?tab=home&locale=ko&authIntent=11111111-1111-4111-8111-111111111111",
    );
    expect(routerPush).not.toHaveBeenCalledWith(expect.stringContaining("/login"));
    randomUUID.mockRestore();
  });

  it("keeps ownership failures recoverable instead of silently showing the wrong CTA", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    let passportAttempts = 0;
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/passports")) {
        passportAttempts += 1;
        return passportAttempts === 1
          ? { ok: false }
          : { ok: true, json: async () => ({ passports: [] }) };
      }
      if (url.includes("/notices")) return { ok: true, json: async () => ({ notices: [] }) };
      if (url.includes("/api/benefits")) return { ok: true, json: async () => ({ benefits: [] }) };
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", request);
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    await waitFor(() => expect(screen.getAllByText("Passport 상태를 확인하지 못했어요.")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[0]);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /팬 인증하기/ })).toHaveLength(1));
    expect(passportAttempts).toBe(2);
  });

  it("uses English state-aware content and keeps locale on LIVE and verification paths", async () => {
    const englishCelebrity = { ...kara, locale: "en" as const, name: "KARA EN", summary: "English CMS summary" };
    const englishLive = { ...upcomingLive, locale: "en" as const, title: "Published English LIVE" };
    render(<CelebrityFanPage celebrity={englishCelebrity} locale="en" upcomingLive={englishLive} />);
    expect(screen.getByText("Take the quiz, verify your fandom, and begin your KARA EN Fan Passport journey.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Published English LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View LIVE details/ })).toHaveAttribute("href", "/live/kara-nualeaf?locale=en");
    expect(screen.getByRole("link", { name: /verify fandom/i })).toHaveAttribute("href", expect.stringContaining("locale=en"));
    expect(await screen.findByRole("link", { name: "Open full calendar" })).toHaveAttribute(
      "href",
      `/live/calendar?month=${currentCalendarMonth()}&locale=en&celebrity=kara`,
    );
  });

});
