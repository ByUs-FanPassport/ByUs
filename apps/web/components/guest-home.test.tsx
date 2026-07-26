import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatKoreanLiveDate, GuestHome } from "./guest-home";
import { formatHeroLiveTitle, formatLiveCountdown } from "./live-hero-carousel";

const privy = vi.hoisted(() => ({
  ready: true,
  authenticated: false,
  getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token"),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => privy,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

const featuredLive = {
  live: {
    id: "819b52d9-62c3-450c-b3dc-78d84d2238c6", slug: "admin-created-live", effectiveStatus: "scheduled" as const,
    startsAt: "2026-07-24T11:00:00.000Z", endsAt: "2026-07-24T12:00:00.000Z", reservationOpensAt: "2026-07-20T00:00:00.000Z", reservationClosesAt: "2026-07-24T11:00:00.000Z",
    title: "관리자가 등록한 LIVE", description: "설명", productContext: "제품", heroImage: { url: "/images/guest-home/kara-hero.png", alt: "관리자 LIVE" },
    celebrity: { slug: "kara", name: "KARA", image: "/images/guest-home/kara-card.jpg" }, brand: { slug: "nualeaf", name: "NUALEAF", logo: "/images/brand.png", websiteUrl: null }, watch: { available: false, url: "https://youtube.com/live/abc" },
  },
  viewer: { authenticated: false, passport: "missing" as const, reservation: null }, primaryAction: "sign_in_to_reserve" as const,
};

const celebrities = [
  { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [{ platform: "youtube", url: "https://youtube.com/@kara" }, { platform: "tiktok", url: "https://tiktok.com/@kara" }, { platform: "instagram", url: "https://instagram.com/kara" }], displayOrder: 0, fanCount: 12_800_000 },
  { slug: "elina", locale: "ko", name: "Elina", summary: "Elina summary", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 1, fanCount: 3_200_000 },
  { slug: "changha", locale: "ko", name: "Changha", summary: "Changha summary", image: { url: "/images/guest-home/changha-card.jpg", alt: "Changha portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 2, fanCount: 1_450_000 },
] as const;
const defaultProps = { celebrities, locale: "ko" as const };

describe("canonical 03 guest home", () => {
  afterEach(() => {
    privy.ready = true;
    privy.authenticated = false;
    privy.getAccessToken.mockReset().mockResolvedValue("token");
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("formats KST deterministically without server locale AM/PM variation", () => {
    expect(formatKoreanLiveDate("2026-07-24T00:05:00.000Z")).toBe("7월 24일 오전 9:05");
    expect(formatKoreanLiveDate("2026-07-24T11:00:00.000Z")).toBe("7월 24일 오후 8:00");
  });

  it("formats the DESIGN countdown contract with and without a day prefix", () => {
    const startsAt = "2026-09-15T11:00:00.000Z";
    expect(formatLiveCountdown(startsAt, Date.parse("2026-09-13T08:57:56.000Z"))).toBe("D-2 02:02:04");
    expect(formatLiveCountdown(startsAt, Date.parse("2026-09-15T10:57:56.000Z"))).toBe("00:02:04");
    expect(formatLiveCountdown(startsAt, Date.parse(startsAt))).toBe("LIVE NOW");
  });

  it("formats Home Hero titles without repeating the brand", () => {
    expect(["KARA", "Elina", "Changha"].map(formatHeroLiveTitle)).toEqual([
      "KARA LIVE",
      "Elina LIVE",
      "Changha LIVE",
    ]);
  });

  it("shows LIVE NOW in the countdown position for an active LIVE", () => {
    render(<GuestHome {...defaultProps} featuredLives={[{
      ...featuredLive,
      live: { ...featuredLive.live, effectiveStatus: "live" },
      primaryAction: "watch_live",
    }]} />);
    expect(screen.getByText("LIVE NOW")).toBeInTheDocument();
    expect(screen.queryByText("KARA × NUALEAF")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /라이브 입장하기/ })).toHaveAttribute(
      "href",
      "/live/admin-created-live?locale=ko",
    );
  });

  it("hydrates the server Home markup without a date text mismatch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);
    document.body.append(container);

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <GuestHome {...defaultProps} featuredLives={[featuredLive]} />); });

    expect(container).toHaveTextContent("7월 24일 오후 8:00");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration|did not match|server rendered html/i);
    expect(consoleWarn.mock.calls.flat().join(" ")).not.toMatch(/width or height|aspect.ratio/i);
    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("keeps the approved service actions and exact Passport label in both responsive placements", () => {
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);

    expect(screen.getAllByRole("link", { name: "Google로 계속하기" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Fan Passport 발급받기/ })).toHaveLength(2);
    expect(
      screen.getByRole("img", {
        name: "빈 Stamp 원 9개가 있는 펼쳐진 Fan Passport",
      }),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("passport-open-blank-9-transparent.png"),
    );
    expect(screen.queryByText("로그인하고 내 Passport 확인하기")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /라이브 예약하기/ })).toHaveAttribute("href", "/login?returnTo=%2Flive%2Fadmin-created-live%3Flocale%3Dko&locale=ko&intent=reserve&entity=admin-created-live");
    expect(screen.getByRole("link", { name: "관리자가 등록한 LIVE 상세 보기" })).toHaveAttribute("href", "/live/admin-created-live?locale=ko");
  });

  it("localizes the nine-empty-stamp Passport image description", () => {
    render(
      <GuestHome
        celebrities={celebrities}
        featuredLives={[featuredLive]}
        locale="en"
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Opened Fan Passport with nine empty Stamp circles",
      }),
    ).toHaveAttribute(
      "src",
      expect.stringContaining("passport-open-blank-9-transparent.png"),
    );
  });

  it("uses the same product destinations in desktop and mobile navigation", () => {
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);

    const primary = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(within(primary).getByRole("link", { name: "HOME" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(primary).getByRole("link", { name: "LIVE" })).toHaveAttribute(
      "href",
      "/live?locale=ko",
    );

    const mobile = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    expect(within(mobile).getByRole("link", { name: "홈" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(mobile).getByRole("link", { name: "MY" })).toHaveAttribute(
      "href",
      "/my?locale=ko",
    );
  });

  it("uses the Korean and English language glyph while preserving locale switching", () => {
    const { rerender } = render(
      <GuestHome {...defaultProps} featuredLives={[featuredLive]} />,
    );

    const koreanLanguageLink = screen.getByRole("link", {
      name: "언어 선택, 현재 한국어",
    });
    expect(koreanLanguageLink).toHaveAttribute("href", "/?locale=en");
    expect(
      koreanLanguageLink.querySelector(
        'svg[data-language-icon="ko-en"] [data-language-glyph="ko"]',
      ),
    ).toHaveAttribute("d", "M3.5 6.5h4.25V13M10.5 5.5v9M10.5 9h2");
    expect(
      koreanLanguageLink.querySelector(
        'svg[data-language-icon="ko-en"] [data-language-glyph="en"]',
      ),
    ).toBeInTheDocument();

    rerender(
      <GuestHome
        celebrities={celebrities}
        featuredLives={[featuredLive]}
        locale="en"
      />,
    );
    expect(
      screen.getByRole("link", {
        name: "Choose language, currently English",
      }),
    ).toHaveAttribute("href", "/?locale=ko");
  });

  it("renders every active and scheduled featured LIVE in the upcoming list", () => {
    const activeLive = {
      ...featuredLive,
      live: {
        ...featuredLive.live,
        effectiveStatus: "live" as const,
      },
      primaryAction: "watch_live" as const,
    };
    const elinaLive = {
      ...featuredLive,
      live: {
        ...featuredLive.live,
        id: "919b52d9-62c3-450c-b3dc-78d84d2238c6",
        slug: "elina-live",
        title: "Elina 예정 LIVE",
        startsAt: "2026-07-25T11:00:00.000Z",
        celebrity: {
          slug: "elina",
          name: "Elina",
          image: "/images/guest-home/elina-card.jpg",
        },
      },
    };
    const changhaLive = {
      ...featuredLive,
      live: {
        ...featuredLive.live,
        id: "a19b52d9-62c3-450c-b3dc-78d84d2238c6",
        slug: "changha-live",
        title: "Changha 예정 LIVE",
        startsAt: "2026-07-26T11:00:00.000Z",
        celebrity: {
          slug: "changha",
          name: "Changha",
          image: "/images/guest-home/changha-card.jpg",
        },
      },
    };

    render(
      <GuestHome
        {...defaultProps}
        featuredLives={[activeLive, elinaLive, changhaLive]}
      />,
    );

    const upcoming = screen
      .getByRole("heading", { name: "다가오는 LIVE" })
      .closest("section");
    expect(upcoming).not.toBeNull();
    const list = within(upcoming!);
    const rows = list.getAllByRole("article");

    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("KARA")).toBeInTheDocument();
    expect(within(rows[0]).getByText("LIVE")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Elina 예정 LIVE")).toBeInTheDocument();
    expect(within(rows[1]).getByText("UPCOMING")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Changha 예정 LIVE")).toBeInTheDocument();
    expect(within(rows[2]).getByText("7월 26일 오후 8:00")).toBeInTheDocument();
    expect(
      within(rows[2]).getByRole("link", {
        name: "Changha 예정 LIVE 상세 보기",
      }),
    ).toHaveAttribute("href", "/live/changha-live?locale=ko");
  });

  it("renders two regular-weight metadata rows with compact fans, live state, and icon-only social controls", () => {
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} celebrityLives={[
      { slug: "kara-live", celebritySlug: "kara", locale: "ko", title: "KARA LIVE", startsAt: "2026-07-24T11:00:00.000Z", effectiveStatus: "live" },
      { slug: "elina-live", celebritySlug: "elina", locale: "ko", title: "Elina LIVE", startsAt: "2026-07-25T11:00:00.000Z", effectiveStatus: "scheduled" },
    ]} />);

    const karaCard = screen.getByRole("heading", { name: "KARA", level: 3 }).closest("article");
    expect(karaCard).not.toBeNull();
    const card = within(karaCard!);
    expect(card.getByRole("link", { name: "KARA YouTube 공식 채널" })).toHaveAttribute("href", "https://youtube.com/@kara");
    expect(card.getByRole("link", { name: "KARA TikTok 공식 채널" })).toHaveAttribute("href", "https://tiktok.com/@kara");
    expect(card.getByRole("link", { name: "KARA Instagram 공식 채널" })).toHaveAttribute("href", "https://instagram.com/kara");
    expect(card.queryByText("YouTube")).not.toBeInTheDocument();
    expect(card.queryByText("TikTok")).not.toBeInTheDocument();
    expect(card.queryByText("Instagram")).not.toBeInTheDocument();
    expect(card.getByText("12.8M Fans")).toBeInTheDocument();
    expect(card.getByText("LIVE 진행중")).toHaveAttribute("data-live-state", "live");
    expect(screen.getByText("3.2M Fans")).toBeInTheDocument();
    expect(screen.getByText("LIVE 예정")).toHaveAttribute("data-live-state", "scheduled");
    expect(screen.getByText("1.5M Fans")).toBeInTheDocument();
    const changhaCard = screen.getByRole("heading", { name: "Changha", level: 3 }).closest("article");
    expect(within(changhaCard!).queryByText(/LIVE/)).not.toBeInTheDocument();
  });

  it("uses a published square Preview only inside the matching favorite card", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} celebrityLives={[
      {
        slug: "kara-live",
        celebritySlug: "kara",
        locale: "ko",
        title: "KARA LIVE",
        startsAt: "2026-07-24T11:00:00.000Z",
        effectiveStatus: "scheduled",
        preview: {
          kind: "artist_teaser",
          durationMs: 4_000,
          square: {
            videoUrl: "https://assets.example/kara-square.mp4",
            posterUrl: "https://assets.example/kara-square.webp",
          },
        },
      },
    ]} />);

    const videos = screen.getAllByTestId("active-preview-video");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toHaveAttribute(
      "poster",
      "https://assets.example/kara-square.webp",
    );
    expect(videos[0]).toHaveAttribute(
      "src",
      "https://assets.example/kara-square.mp4",
    );
    expect(screen.getByRole("img", { name: "Elina portrait" })).toBeInTheDocument();
  });

  it("lets desktop users collapse and restore the context panel without removing mobile actions", () => {
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);

    const toggle = screen.getByRole("button", { name: "팬 활동 영역 접기" });
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "로그인 전 팬 활동" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "팬 활동 영역 펼치기" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "로그인 및 Fan Passport 시작" })).toBeInTheDocument();
  });

  it("renders a truthful empty state without inventing a Live link", () => {
    render(<GuestHome {...defaultProps} featuredLives={[]} />);
    expect(screen.getByText("현재 공개된 LIVE가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /라이브 예약하기/ })).not.toBeInTheDocument();

  });

  it("uses the effective state to avoid presenting an ended Live as reservable", () => {
    render(<GuestHome {...defaultProps} featuredLives={[{
      ...featuredLive,
      live: { ...featuredLive.live, effectiveStatus: "ended" },
      primaryAction: "live_ended",
    }]} />);
    expect(screen.queryByRole("link", { name: /라이브 예약하기/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LIVE 상세보기" })).toHaveAttribute("href", "/live/admin-created-live?locale=ko");
  });

  it("renders English CMS content and preserves locale through public and auth links", () => {
    const englishCelebrities = celebrities.map((celebrity) => ({ ...celebrity, locale: "en" as const, name: celebrity.slug === "kara" ? "KARA EN" : celebrity.name }));
    render(<GuestHome celebrities={englishCelebrities} featuredLives={[featuredLive]} locale="en" />);
    expect(screen.getByRole("heading", { name: "Your favorites" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "KARA EN" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA EN details" })).toHaveAttribute("href", "/c/kara?locale=en");
    expect(screen.getByRole("link", { name: /Reserve LIVE/ })).toHaveAttribute("href", expect.stringContaining("locale=en"));
  });

  it("uses Enter LIVE for the English active-LIVE Hero without changing the detail route", () => {
    render(<GuestHome {...defaultProps} locale="en" featuredLives={[{
      ...featuredLive,
      live: { ...featuredLive.live, effectiveStatus: "live" },
      primaryAction: "watch_live",
    }]} />);
    expect(screen.getByRole("link", { name: /Enter LIVE/ })).toHaveAttribute(
      "href",
      "/live/admin-created-live?locale=en",
    );
  });

  it("auto-advances every six seconds and supports clean previous, next, and indicator controls", () => {
    vi.useFakeTimers();
    const secondLive = {
      ...featuredLive,
      live: {
        ...featuredLive.live,
        id: "919b52d9-62c3-450c-b3dc-78d84d2238c6",
        slug: "elina-live",
        title: "Elina 예정 LIVE",
        celebrity: { ...featuredLive.live.celebrity, slug: "elina", name: "Elina" },
      },
    };
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive, secondLive]} />);

    expect(screen.getByRole("heading", { name: "KARA LIVE", level: 2 })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("heading", { name: "Elina LIVE", level: 2 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 LIVE" }));
    expect(screen.getByRole("heading", { name: "KARA LIVE", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1번째 LIVE 보기" })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: /자동 재생/ })).not.toBeInTheDocument();
  });

  it("pauses automatic playback during hover and disables it for reduced motion", () => {
    vi.useFakeTimers();
    const secondLive = {
      ...featuredLive,
      live: { ...featuredLive.live, slug: "elina-live", title: "Elina 예정 LIVE" },
    };
    const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => mediaListeners.delete(listener),
    }));
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive, secondLive]} />);

    const carousel = screen.getByRole("region", { name: "주요 LIVE" });
    expect(carousel).toHaveAttribute("data-reduced-motion", "true");
    fireEvent.mouseEnter(carousel);
    act(() => vi.advanceTimersByTime(12_000));
    fireEvent.mouseLeave(carousel);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("heading", { name: "KARA LIVE", level: 2 })).toBeInTheDocument();
  });

  it("does not flash guest actions while authentication is still loading", () => {
    privy.ready = false;
    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);

    expect(screen.queryByRole("link", { name: "Google로 계속하기" })).not.toBeInTheDocument();
    expect(screen.getAllByText("팬 활동을 불러오는 중이에요.")).toHaveLength(2);
  });

  it("renders the authenticated Passport-first state from the MY summary", async () => {
    privy.authenticated = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          profile: { nickname: "카밀리아" },
          passports: [{
            id: "11111111-1111-4111-8111-111111111111",
            celebrity: { slug: "kara", name: "KARA", image: "/images/guest-home/kara-card.jpg" },
            issuedAt: "2026-07-21T00:00:00.000Z",
            stampCount: 2,
            score: { level: "Silver" },
            display: { level: "실버" },
            stampSummary: { knowledge: 1, reservation: 1, attendance: 0, survey: 0, total: 2 },
            stamps: [
              { type: "knowledge", issuedAt: "2026-07-21T00:00:00.000Z" },
              { type: "reservation", issuedAt: "2026-07-22T00:00:00.000Z" },
            ],
          }],
          reservations: [{
            id: "22222222-2222-4222-8222-222222222222",
            slug: "kara-live",
            title: "KARA LIVE",
            startsAt: "2026-07-31T11:00:00.000Z",
            status: "scheduled",
            celebrity: { name: "KARA", image: "/images/guest-home/kara-card.jpg" },
          }],
          availableBenefitCount: 0,
          unreadNotificationCount: 0,
        },
      }),
    }));

    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);

    expect(await screen.findAllByRole("heading", { name: "카밀리아님, 반가워요." })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Google로 계속하기" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "KARA Fan Passport, 실버, Stamp 2개" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /KARA Fan Passport 상세 보기, 실버, Stamp 2개/ })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "LIVE 상세 보기" })).toHaveLength(2);
  });

  it("shows truthful authenticated empty states and retries summary failures", async () => {
    privy.authenticated = true;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          summary: {
            profile: { nickname: null },
            passports: [],
            reservations: [],
            availableBenefitCount: 0,
            unreadNotificationCount: 0,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);
    const retryButtons = await screen.findAllByRole("button", { name: "다시 시도" });
    fireEvent.click(retryButtons[0]);

    expect(await screen.findAllByText("아직 발급된 Passport가 없어요.")).toHaveLength(2);
    expect(screen.getAllByText("팬 인증 완료 후 발급돼요.")).toHaveLength(2);
    const passportPreviews = screen.getAllByRole("img", {
      name: "발급 전 Fan Passport 미리보기",
    });
    expect(passportPreviews).toHaveLength(2);
    passportPreviews.forEach((preview) => {
      expect(preview).toHaveAttribute(
        "src",
        expect.stringContaining("passport-open-blank-9-transparent.png"),
      );
    });
    expect(screen.getAllByText("예약한 LIVE가 없어요.")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /팬 인증할 최애 찾기/ })).toHaveLength(2);
  });

  it("limits Passport artwork to the latest nine actual stamps while announcing the total", async () => {
    privy.authenticated = true;
    const stamps = Array.from({ length: 10 }, (_, index) => ({
      type: (["knowledge", "reservation", "attendance", "survey"] as const)[index % 4],
      issuedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: {
          profile: { nickname: "Fan" },
          passports: [{
            id: "11111111-1111-4111-8111-111111111111",
            celebrity: { slug: "kara", name: "KARA", image: "/kara.jpg" },
            issuedAt: "2026-07-21T00:00:00.000Z",
            stampCount: 10,
            score: { level: "Gold" },
            display: { level: "골드" },
            stampSummary: { knowledge: 3, reservation: 3, attendance: 2, survey: 2, total: 10 },
            stamps,
          }],
          reservations: [],
          availableBenefitCount: 0,
          unreadNotificationCount: 0,
        },
      }),
    }));

    const { container } = render(<GuestHome {...defaultProps} featuredLives={[featuredLive]} />);
    expect(await screen.findAllByRole("img", { name: "KARA Fan Passport, 골드, 전체 10개 중 최근 9개 표시" })).toHaveLength(2);
    expect(container.querySelectorAll("[data-passport-stamp]")).toHaveLength(18);
  });
});
