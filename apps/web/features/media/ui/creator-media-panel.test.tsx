import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorMediaPanel } from "./creator-media-panel";

const state = vi.hoisted(() => ({ query: "tab=board&section=media&locale=ko", failure: "", allEmpty: false, replace: vi.fn(), more: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/elina", useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, generation: 0 }) }));
vi.mock("@/features/fanpage/ui/use-news-source", () => ({ useNewsSource: (url: string | null) => {
  const youtube = url?.includes("/youtube");
  const failed = state.failure === "all" || (youtube && state.failure === "youtube");
  const official = url?.includes("/media?"), replay = url?.includes("/api/live-events");
  return {
    state: { status: failed ? "error" : "ready", data: failed || state.allEmpty ? [] : youtube ? [{ id: "yt", kind: "videos", title: "공식 채널 영상", image: "/youtube.jpg", asset: null, href: "https://www.youtube.com/watch?v=abcdefghijk", date: "2026-09-27T00:00:00Z" }] : official ? [{ id: "photo", kind: "photos", title: "함께한 사진", image: "/photo.jpg", asset: null, href: "/c/elina/notices/photo", date: "2026-09-26T00:00:00Z" }]
      : replay ? [{ id: "replay", kind: "replays", title: "함께한 LIVE", image: "/replay.jpg", href: "https://youtube.com/watch?v=recorded", date: "2026-09-26T00:00:00Z", slug: "elina" }] : [],
      nextCursor: official || url?.includes("/chzzk") ? "older" : null, moreLoading: false, moreError: false },
    retry: vi.fn(), loadMore: state.more,
  };
} }));
beforeEach(() => { state.query = "tab=board&section=media&locale=ko"; state.replace.mockClear(); state.failure = ""; state.allEmpty = false; });
afterEach(cleanup);

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
  expect(screen.getByRole("link", { name: /함께한 사진/ })).toHaveTextContent("ByUs");
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
