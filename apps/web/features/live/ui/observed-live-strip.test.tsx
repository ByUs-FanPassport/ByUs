import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObservedLiveStrip } from "./observed-live-strip";
import type { ObservedLiveCard } from "../domain/observed-live";

const start = Date.parse("2026-09-11T14:00:00Z");
const card: ObservedLiveCard = {
  celebritySlug: "ifewknow", creatorName: "이퓨", handle: "ifewknow",
  title: "함께 노래해요", thumbnailUrl: "/images/live.jpg",
  watchUrl: "https://www.tiktok.com/@ifewknow/live",
  observedAt: new Date(start).toISOString(), expiresAt: new Date(start + 90_000).toISOString(),
};
const response = (items = [card]) => Response.json({ items, checkedAt: new Date(start).toISOString(), coverage: { live: items.length, offline: 0, unavailable: 0, stale: 0 } });
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe("observed TikTok LIVE cards", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(["ko", "en"] as const)("opens TikTok with localized accessible copy in %s", async (locale) => {
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetcher);
    render(<ObservedLiveStrip locale={locale} />);
    await settle();
    const link = screen.getByRole("link", { name: new RegExp(locale === "ko" ? "틱톡에서 시청, 새 창" : "Watch on TikTok, new tab") });
    expect(link).toHaveAttribute("href", card.watchUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(fetcher).toHaveBeenCalledWith(`/api/public/live-now?locale=${locale}`, expect.objectContaining({ cache: "no-store" }));
  });

  it("removes ended broadcasts on the next automatic refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(response([])));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    expect(screen.getByRole("link")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("updates the position after a swipe and resets when the visible roster changes", async () => {
    const second = { ...card, celebritySlug: "elina", creatorName: "엘리나" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([card, second])).mockResolvedValue(response([second])));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    const links = screen.getAllByRole("link");
    const grid = links[0].parentElement!;
    Object.defineProperty(links[0], "offsetLeft", { value: 8 });
    Object.defineProperty(links[1], "offsetLeft", { value: 374 });
    fireEvent.scroll(grid, { target: { scrollLeft: 366 } });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "다음 틱톡 LIVE" })).not.toBeInTheDocument();
  });

  it("falls back to the creator image when a LIVE cover expires", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ ...card, fallbackThumbnailUrl: "/creator.jpg" }])));
    const { container } = render(<ObservedLiveStrip locale="ko" />); await settle();
    const image = container.querySelector("img")!;
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/creator.jpg");
    fireEvent.error(image);
    expect(image).toHaveStyle({ visibility: "hidden" });
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("clears LIVE on failed refresh instead of retaining old success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(new Response(null, { status: 503 })));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("expires cards even while a hidden tab does not poll", async () => {
    const fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetcher);
    render(<ObservedLiveStrip locale="ko" />); await settle();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("does not display already stale, future, or invalid observations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([
      { ...card, observedAt: new Date(start - 91_000).toISOString(), expiresAt: new Date(start + 90_000).toISOString() },
      { ...card, observedAt: new Date(start + 5_000).toISOString() },
      { ...card, expiresAt: "invalid" },
    ])));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
