import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorMediaPanel } from "./creator-media-panel";

const state = vi.hoisted(() => ({ query: "tab=media&locale=ko", replace: vi.fn(), more: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/elina", useSearchParams: () => new URLSearchParams(state.query), useRouter: () => ({ replace: state.replace }) }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("@/components/byus-session-provider", () => ({ useByUsSession: () => ({ ready: true, generation: 0 }) }));
vi.mock("@/features/fanpage/ui/use-news-source", () => ({ useNewsSource: (url: string | null) => {
  const official = url?.includes("/media?"), replay = url?.includes("/api/live-events");
  return {
    state: { status: "ready", data: official ? [{ id: "photo", kind: "photos", title: "함께한 사진", image: "/photo.jpg", asset: null, href: "/c/elina/notices/photo", date: "2026-09-26T00:00:00Z" }]
      : replay ? [{ id: "replay", kind: "replays", title: "함께한 LIVE", image: "/replay.jpg", href: "https://youtube.com/watch?v=recorded", date: "2026-09-26T00:00:00Z", slug: "elina" }] : [],
      nextCursor: official || url?.includes("/chzzk") ? "older" : null, moreLoading: false, moreError: false },
    retry: vi.fn(), loadMore: state.more,
  };
} }));
beforeEach(() => { state.query = "tab=media&locale=ko"; state.replace.mockClear(); });
afterEach(cleanup);

it("makes the thumbnail and text one link, and restores the media filter from its URL", () => {
  const { rerender } = render(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);
  const photo = screen.getByRole("link", { name: /함께한 사진/ });
  expect(photo.querySelector("img")).not.toBeNull();
  expect(photo).toHaveAttribute("href", "/c/elina/notices/photo?locale=ko");
  fireEvent.click(screen.getByRole("button", { name: "다시보기" }));
  expect(state.replace).toHaveBeenCalledWith("/elina?tab=media&locale=ko&media=replays", { scroll: false });
  state.query = "tab=media&locale=ko&media=replays";
  rerender(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);
  expect(screen.getByRole("button", { name: "다시보기" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("link", { name: /함께한 사진/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /함께한 LIVE/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /더 보기/ })).not.toBeInTheDocument();
});

it("gives an empty media filter a clear label and a route back to the creator", () => {
  state.query = "tab=media&locale=ko&media=videos";
  render(<CreatorMediaPanel slug="elina" locale="ko" channelId="channel" />);

  const empty = screen.getByRole("status");
  expect(empty).toHaveTextContent("영상");
  expect(empty).toHaveTextContent("아직 등록된 항목이 없어요.");
  expect(screen.getByRole("link", { name: "돌아가기" })).toHaveAttribute("href", "/elina?locale=ko");
});
