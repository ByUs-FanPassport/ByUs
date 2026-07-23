import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatKoreanLiveDate, GuestHome } from "./guest-home";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
  { slug: "kara", locale: "ko", name: "KARA", summary: "KARA summary", image: { url: "/images/guest-home/kara-card.jpg", alt: "KARA portrait", position: "center" }, themes: [], socialLinks: [{ platform: "youtube", url: "https://youtube.com/@kara" }, { platform: "tiktok", url: "https://tiktok.com/@kara" }, { platform: "instagram", url: "https://instagram.com/kara" }], displayOrder: 0 },
  { slug: "elina", locale: "ko", name: "Elina", summary: "Elina summary", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 1 },
  { slug: "changha", locale: "ko", name: "Changha", summary: "Changha summary", image: { url: "/images/guest-home/changha-card.jpg", alt: "Changha portrait", position: "center" }, themes: [], socialLinks: [], displayOrder: 2 },
] as const;
const defaultProps = { celebrities, locale: "ko" as const };

describe("canonical 03 guest home", () => {
  it("formats KST deterministically without server locale AM/PM variation", () => {
    expect(formatKoreanLiveDate("2026-07-24T00:05:00.000Z")).toBe("7월 24일 오전 9:05");
    expect(formatKoreanLiveDate("2026-07-24T11:00:00.000Z")).toBe("7월 24일 오후 8:00");
  });

  it("hydrates the server Home markup without a date text mismatch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const container = document.createElement("div");
    container.innerHTML = renderToString(<GuestHome {...defaultProps} featuredLive={featuredLive} />);
    document.body.append(container);

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(container, <GuestHome {...defaultProps} featuredLive={featuredLive} />); });

    expect(container).toHaveTextContent("7월 24일 오후 8:00");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration|did not match|server rendered html/i);
    expect(consoleWarn.mock.calls.flat().join(" ")).not.toMatch(/width or height|aspect.ratio/i);
    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it("keeps the approved service actions and exact Passport label in both responsive placements", () => {
    render(<GuestHome {...defaultProps} featuredLive={featuredLive} />);

    expect(screen.getAllByRole("link", { name: "Google로 계속하기" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Fan Passport 발급받기/ })).toHaveLength(2);
    expect(screen.queryByText("로그인하고 내 Passport 확인하기")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /라이브 예약하기/ })).toHaveAttribute("href", "/login?returnTo=%2Flive%2Fadmin-created-live%3Flocale%3Dko&locale=ko&intent=reserve&entity=admin-created-live");
    expect(screen.getByRole("link", { name: "관리자가 등록한 LIVE 상세 보기" })).toHaveAttribute("href", "/live/admin-created-live?locale=ko");
  });

  it("keeps the guest-specific desktop and mobile navigation contract", () => {
    render(<GuestHome {...defaultProps} featuredLive={featuredLive} />);

    const primary = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(within(primary).getByRole("link", { name: "HOME" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(primary).getByRole("link", { name: "LIVE" })).toHaveAttribute(
      "href",
      "#upcoming",
    );

    const mobile = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    expect(within(mobile).getByRole("link", { name: "홈" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(mobile).getByRole("link", { name: "Passport" })).toHaveAttribute(
      "href",
      "/passports?locale=ko",
    );
  });

  it("renders social services as icon-only controls beside each artist name", () => {
    render(<GuestHome {...defaultProps} featuredLive={featuredLive} />);

    const karaCard = screen.getByRole("heading", { name: "KARA", level: 3 }).closest("article");
    expect(karaCard).not.toBeNull();
    const card = within(karaCard!);
    expect(card.getByRole("link", { name: "KARA YouTube 공식 채널" })).toHaveAttribute("href", "https://youtube.com/@kara");
    expect(card.getByRole("link", { name: "KARA TikTok 공식 채널" })).toHaveAttribute("href", "https://tiktok.com/@kara");
    expect(card.getByRole("link", { name: "KARA Instagram 공식 채널" })).toHaveAttribute("href", "https://instagram.com/kara");
    expect(card.queryByText("YouTube")).not.toBeInTheDocument();
    expect(card.queryByText("TikTok")).not.toBeInTheDocument();
    expect(card.queryByText("Instagram")).not.toBeInTheDocument();
  });

  it("lets desktop users collapse and restore the context panel without removing mobile actions", () => {
    render(<GuestHome {...defaultProps} featuredLive={featuredLive} />);

    const toggle = screen.getByRole("button", { name: "로그인 및 Passport 영역 접기" });
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "로그인 전 팬 활동" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그인 및 Passport 영역 펼치기" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("region", { name: "로그인 및 Fan Passport 시작" })).toBeInTheDocument();
  });

  it("renders a truthful empty state without inventing a Live link", () => {
    render(<GuestHome {...defaultProps} featuredLive={null} />);
    expect(screen.getByText("현재 공개된 LIVE가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /라이브 예약하기/ })).not.toBeInTheDocument();

  });

  it("uses the effective state to avoid presenting an ended Live as reservable", () => {
    render(<GuestHome {...defaultProps} featuredLive={{
      ...featuredLive,
      live: { ...featuredLive.live, effectiveStatus: "ended" },
      primaryAction: "live_ended",
    }} />);
    expect(screen.queryByRole("link", { name: /라이브 예약하기/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LIVE 상세보기" })).toHaveAttribute("href", "/live/admin-created-live?locale=ko");
  });

  it("renders English CMS content and preserves locale through public and auth links", () => {
    const englishCelebrities = celebrities.map((celebrity) => ({ ...celebrity, locale: "en" as const, name: celebrity.slug === "kara" ? "KARA EN" : celebrity.name }));
    render(<GuestHome celebrities={englishCelebrities} featuredLive={featuredLive} locale="en" />);
    expect(screen.getByRole("heading", { name: "Your favorites" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "KARA EN" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "KARA EN details" })).toHaveAttribute("href", "/c/kara?locale=en");
    expect(screen.getByRole("link", { name: /Reserve LIVE/ })).toHaveAttribute("href", expect.stringContaining("locale=en"));
  });
});
