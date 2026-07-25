import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("published celebrity fan page", () => {
  beforeEach(() => { authenticated = false; getAccessToken.mockReset(); routerPush.mockReset(); vi.unstubAllGlobals(); });

  it("renders the four-tab fan hub with a persistent Hero and the Home panel", () => {
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    expect(screen.getAllByRole("link", { name: "ByUs 홈" })[0]).toHaveAttribute("href", "/?locale=ko");
    expect(screen.getByRole("heading", { name: "KARA" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "KARA 팬페이지 메뉴" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["홈", "공지", "LIVE", "혜택"]);
    expect(screen.getByRole("tab", { name: "홈" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "KARA Profile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LIVE 자세히 보기" })).toHaveAttribute("href", "/live/kara-nualeaf?locale=ko");
    expect(screen.getAllByRole("link", { name: /팬 인증하기/ })[0]).toHaveAttribute("href", expect.stringContaining("intent=passport"));
    expect(screen.getByAltText("모든 Stamp 칸이 비어 있는 펼쳐진 Fan Passport")).toBeInTheDocument();
  });

  it("renders honest Home empty states for missing LIVE and SNS data", () => {
    render(<CelebrityFanPage celebrity={changha} locale="ko" upcomingLive={null} />);
    expect(screen.getByText("공개된 LIVE가 아직 없어요.")).toBeInTheDocument();
    expect(screen.getByText("공개된 채널 링크가 아직 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /LIVE 자세히 보기/ })).not.toBeInTheDocument();
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notices: [{ slug: "opening", title: "공식 오픈 안내", pinned: true, publishedAt: "2026-07-25T10:00:00.000Z" }] }),
    }));
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
    fireEvent.keyDown(screen.getByRole("tab", { name: "홈" }), { key: "ArrowRight" });
    expect(routerPush).toHaveBeenCalledWith("/c/kara?tab=notice&locale=ko");
    fireEvent.keyDown(screen.getByRole("tab", { name: "홈" }), { key: "End" });
    expect(routerPush).toHaveBeenLastCalledWith("/c/kara?tab=benefits&locale=ko");
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
      screen.getByRole("link", { name: "LIVE 자세히 보기" }),
    ).toHaveAttribute("href", "/live/kara-nualeaf?locale=ko");
  });

  it("switches both primary actions to the existing Passport as soon as ownership resolves", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ passports: [{ id: "8a6c0050-4c52-4e0f-b73a-e2f4aab48b85", celebrity: { slug: "kara" } }] }) }));
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Passport 열기/ })).toHaveLength(2));
    for (const action of screen.getAllByRole("link", { name: /Passport 열기/ })) {
      expect(action).toHaveAttribute("href", "/passports/8a6c0050-4c52-4e0f-b73a-e2f4aab48b85?locale=ko");
    }
    expect(screen.queryByRole("link", { name: /팬 인증하기/ })).not.toBeInTheDocument();
  });

  it("keeps ownership failures recoverable instead of silently showing the wrong CTA", async () => {
    authenticated = true;
    getAccessToken.mockResolvedValue("token");
    const request = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ passports: [] }) });
    vi.stubGlobal("fetch", request);
    render(<CelebrityFanPage celebrity={kara} locale="ko" upcomingLive={upcomingLive} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Passport 상태를 확인하지 못했어요."));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: /팬 인증하기/ })).toHaveLength(2));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses English published content and keeps locale on LIVE and verification paths", () => {
    const englishCelebrity = { ...kara, locale: "en" as const, name: "KARA EN", summary: "English CMS summary" };
    const englishLive = { ...upcomingLive, locale: "en" as const, title: "Published English LIVE" };
    render(<CelebrityFanPage celebrity={englishCelebrity} locale="en" upcomingLive={englishLive} />);
    expect(screen.getAllByText("English CMS summary")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Published English LIVE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View LIVE details/ })).toHaveAttribute("href", "/live/kara-nualeaf?locale=en");
    expect(screen.getAllByRole("link", { name: /Verify fandom/ })[0]).toHaveAttribute("href", expect.stringContaining("locale=en"));
  });

});
