import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorMediaPanel } from "./creator-media-panel";
import { APP_LOCALES } from "@/i18n/locales";

const state = vi.hoisted(() => ({ query: "tab=board&section=media&locale=ko", failure: "", allEmpty: false, manyVideos: false, replace: vi.fn(), more: vi.fn(), sources: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/elina", useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, generation: 0 }) }));
vi.mock("@/features/fanpage/ui/use-news-source", () => ({ useNewsSource: (url: string | null) => {
  state.sources(url);
  const youtube = url?.includes("/youtube");
  const failed = state.failure === "all" || (youtube && state.failure === "youtube");
  const official = url?.includes("/media?"), replay = url?.includes("/api/live-events");
  const videos = Array.from({ length: state.manyVideos ? 6 : 1 }, (_, i) => ({ id: `yt${i}`, kind: "videos", title: i ? `영상 ${i}` : "공식 채널 영상", image: "/youtube.jpg", asset: null, href: `https://www.youtube.com/watch?v=${i ? `abcdefghij${i}` : "abcdefghijk"}`, date: "2026-09-27T00:00:00Z" }));
  return {
    state: { status: failed ? "error" : "ready", data: failed || state.allEmpty ? [] : youtube ? videos : official ? [{ id: "photo", kind: "photos", title: "함께한 사진", image: "/photo.jpg", asset: null, href: "/c/elina/notices/photo", date: "2026-09-26T00:00:00Z" }, ...(state.manyVideos ? [{ ...videos[0], id: "curated", title: "등록한 대표 영상", href: "https://youtu.be/abcdefghijk" }] : [])]
      : replay ? [{ id: "replay", kind: "replays", title: "함께한 LIVE", image: "/replay.jpg", href: "https://youtube.com/watch?v=recorded", date: "2026-09-26T00:00:00Z", slug: "elina" }] : [],
      nextCursor: official || url?.includes("/chzzk") ? "older" : null, moreLoading: false, moreError: false },
    retry: vi.fn(), loadMore: state.more,
  };
} }));
beforeEach(() => { state.query = "tab=board&section=media&locale=ko"; state.replace.mockClear(); state.sources.mockClear(); state.failure = ""; state.allEmpty = false; state.manyVideos = false; });
afterEach(cleanup);

it("uses WENA's published social links for the same feeds as other creators", () => {
  render(<CreatorMediaPanel slug="wena" locale="ko" socialLinks={[{ platform: "instagram", url: "https://www.instagram.com/wena_official_/" }, { platform: "youtube", url: "https://www.youtube.com/channel/UCpiXCVf9CaYppJQDDyiD6nA" }]} />);
  expect(state.sources).toHaveBeenCalledWith("/api/celebrities/wena/media?locale=ko");
  expect(state.sources).toHaveBeenCalledWith("/api/celebrities/wena/instagram");
  expect(state.sources).toHaveBeenCalledWith("/api/celebrities/wena/youtube");
  expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://www.instagram.com/wena_official_/");
  expect(screen.getByRole("link", { name: /함께한 사진/ })).toBeInTheDocument();
});

it("makes the thumbnail and text one link, and restores the media filter from its URL", () => {
  const { rerender } = render(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);
  const photo = screen.getByRole("link", { name: /함께한 사진/ });
  expect(photo.querySelector("img")).not.toBeNull();
  let photoHref = new URL(photo.getAttribute("href")!, "https://byus.test");
  expect(photoHref.searchParams.get("locale")).toBe("ko");
  expect(photoHref.searchParams.get("returnTo")).toBe("/elina?tab=board&section=media&locale=ko#celebrity-content");
  state.query = "tab=board&section=media&locale=ko&media=photos";
  rerender(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);
  photoHref = new URL(screen.getByRole("link", { name: /함께한 사진/ }).getAttribute("href")!, "https://byus.test");
  expect(photoHref.searchParams.get("returnTo")).toBe("/elina?tab=board&section=media&locale=ko&media=photos#celebrity-content");
  fireEvent.click(screen.getByRole("button", { name: "다시보기" }));
  expect(state.replace).toHaveBeenCalledWith("/elina?tab=board&section=media&locale=ko&media=replays#celebrity-content", { scroll: false });
  state.query = "tab=board&section=media&locale=ko&media=replays";
  rerender(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);
  expect(screen.getByRole("button", { name: "다시보기" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("link", { name: /함께한 사진/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /함께한 LIVE/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
});

it("clears an empty media filter without repeating its title", () => {
  state.query = "tab=board&section=media&locale=ko&media=videos";
  render(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);

  const empty = screen.getByRole("status");
  expect(empty).toHaveTextContent("아직 등록된 항목이 없어요.");
  expect(empty.querySelector("strong")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
  expect(state.replace).toHaveBeenCalledWith("/elina?tab=board&section=media&locale=ko#celebrity-content", { scroll: false });
});

const officialChannel = [{ platform: "youtube" as const, url: "https://www.youtube.com/@ElinaKarimova" }];
it("labels official sources and keeps successful media visible when YouTube fails", () => {
  state.failure = "youtube";
  render(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} />);
  expect(screen.getByRole("link", { name: /함께한 사진/ })).toHaveTextContent("kyaa");
  expect(screen.getByRole("link", { name: /함께한 LIVE/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute("target", "_blank");
  expect(screen.queryByText(/아직 모아둔 미디어/)).not.toBeInTheDocument();
});
it("shows verified video attribution and keeps true empty distinct from source failure", () => {
  const { rerender } = render(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} />);
  expect(screen.getByRole("link", { name: /공식 채널 영상/ })).toHaveTextContent("YouTube");
  expect(screen.getByRole("link", { name: /공식 채널 영상/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk");
  state.allEmpty = true;
  rerender(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} />);
  expect(screen.getByText(/아직 모아둔 미디어/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "피드" })).toHaveAttribute("href", "/elina?tab=board&locale=ko#celebrity-content");
  state.failure = "all";
  rerender(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} />);
  expect(screen.queryByText(/아직 모아둔 미디어/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "다시 시도" }).length).toBeGreaterThan(0);
});

it("links an all-empty creator without official channels back to the board feed", () => {
  state.allEmpty = true;
  render(<CreatorMediaPanel slug="elina" locale="ko" />);
  expect(screen.getByRole("status")).toHaveTextContent("아직 등록된 항목이 없어요.");
  expect(screen.getByRole("link", { name: "피드" })).toHaveAttribute("href", "/elina?tab=board&locale=ko#celebrity-content");
});

it("previews current media independently of board filters and starts a video only on request", () => {
  state.query = "locale=ko&media=photos";
  const { container } = render(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} preview />);
  expect(container.querySelector("iframe")).toBeNull();
  expect(state.sources).not.toHaveBeenCalledWith("/api/celebrities/elina/instagram");
  expect(screen.getByRole("link", { name: /함께한 사진/ })).toHaveAttribute("href", expect.stringContaining("returnTo=%2Felina%3Flocale%3Dko"));
  expect(screen.queryByRole("button", { name: "전체" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "재생 · 공식 채널 영상" }));
  const player = screen.getByTitle("재생 · 공식 채널 영상");
  expect(player).toHaveAttribute("src", "https://www.youtube.com/embed/abcdefghijk?autoplay=1&playsinline=1&hl=ko");
  expect(player).toHaveFocus();
  expect(screen.getByRole("link", { name: /공식 채널 영상/ })).toHaveAttribute("data-outbound-kind", "external");
});

it("omits successful empty home sections but keeps failures recoverable", () => {
  state.allEmpty = true;
  const { container, rerender } = render(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} preview />);
  expect(container).toBeEmptyDOMElement();
  state.failure = "youtube";
  rerender(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} preview />);
  expect(screen.getByRole("alert")).toHaveTextContent("YouTube");
  expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});

it("keeps a curated video first, deduplicates its YouTube upload and bounds each home group", () => {
  state.manyVideos = true;
  const { container } = render(<CreatorMediaPanel slug="elina" locale="ko" socialLinks={officialChannel} preview />);
  const videos = container.querySelectorAll('[data-media-kind="videos"]');
  expect(videos).toHaveLength(3);
  expect(videos[0]).toHaveTextContent("등록한 대표 영상");
  expect(screen.queryByRole("button", { name: /공식 채널 영상/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /함께한 사진/ })).toBeInTheDocument();
});

it.each(APP_LOCALES)("preserves preview navigation and accessible video controls in %s", locale => {
  const { container } = render(<CreatorMediaPanel slug="elina" locale={locale} socialLinks={officialChannel} preview />);
  const destinations = [...container.querySelectorAll('a[href*="section=media"]')].map(a => a.getAttribute("href"));
  expect(destinations).toContain(`/elina?tab=board&section=media&locale=${locale}&media=videos#celebrity-content`);
  expect(destinations).toContain(`/elina?tab=board&section=media&locale=${locale}&media=photos#celebrity-content`);
  expect(screen.getByRole("button", { name: /공식 채널 영상/ })).toBeInTheDocument();
});
