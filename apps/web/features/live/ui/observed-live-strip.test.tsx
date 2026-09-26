import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservedLiveCard, ObservedLiveTarget } from "../domain/observed-live";
import { ObservedLiveStrip } from "./observed-live-strip";

vi.mock("next/dynamic", () => ({ default: () => function Player({ item, onClose }: { item: ObservedLiveCard; onClose: () => void }) {
  return <div role="dialog" aria-label={`${item.creatorName} LIVE`}><button onClick={onClose}>Close LIVE</button></div>;
} }));

const start = Date.parse("2026-09-11T14:00:00Z");
const card: ObservedLiveCard = {
  platform: "tiktok",
  celebritySlug: "ifewknow", creatorName: "이퓨", handle: "ifewknow",
  title: "함께 노래해요", thumbnailUrl: "/images/live.jpg",
  watchUrl: "https://www.tiktok.com/@ifewknow/live",
  observedAt: new Date(start).toISOString(), expiresAt: new Date(start + 90_000).toISOString(),
};
const targetFor = (item: ObservedLiveCard, state: ObservedLiveTarget["state"] = "live", observedAt: string | null = item.observedAt): ObservedLiveTarget => ({
  celebritySlug: item.celebritySlug,
  platform: item.platform ?? "tiktok",
  handle: item.handle,
  state,
  observedAt,
});
const response = (
  items: ObservedLiveCard[] = [card],
  targets: ObservedLiveTarget[] = items.map((item) => targetFor(item)),
  checkedAt = new Date(start).toISOString(),
) => Response.json({
  items,
  targets,
  checkedAt,
  coverage: {
    live: targets.filter((target) => target.state === "live").length,
    offline: targets.filter((target) => target.state === "offline").length,
    unavailable: targets.filter((target) => target.state === "unavailable").length,
    stale: targets.filter((target) => target.state === "stale").length,
  },
});
async function settle() { await act(async () => { await Promise.resolve(); }); }

describe("observed LIVE cards", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(["ko", "en"] as const)("offers in-app playback with localized accessible copy in %s", async (locale) => {
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetcher);
    render(<ObservedLiveStrip locale={locale} />);
    await settle();
    expect(screen.getByRole("heading", { name: locale === "ko" ? "지금 LIVE 중" : "Live now" })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /ByUs/ });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(fetcher).toHaveBeenCalledWith(`/api/public/live-now?locale=${locale}&v=4`, expect.objectContaining({ cache: "no-store" }));
  });

  it("uses a mixed-platform heading and keeps four providers for the same creator", async () => {
    const youtube: ObservedLiveCard = {
      ...card,
      platform: "youtube",
      title: "YouTube 라이브",
      thumbnailUrl: "https://i.ytimg.com/vi/abcDEF123_-/hqdefault.jpg",
      watchUrl: "https://www.youtube.com/watch?v=abcDEF123_-",
    };
    const instagram: ObservedLiveCard = {
      ...card,
      platform: "instagram",
      title: "Instagram 라이브",
      thumbnailUrl: "/images/instagram-live.jpg",
      watchUrl: "https://www.instagram.com/stories/ifewknow/3984542264785618047",
      expiresAt: new Date(start + 300_000).toISOString(),
    };
    const chzzk: ObservedLiveCard = {
      ...card,
      platform: "chzzk",
      handle: "a".repeat(32),
      title: "CHZZK 라이브",
      watchUrl: `https://chzzk.naver.com/live/${"a".repeat(32)}`,
      expiresAt: new Date(start + 180_000).toISOString(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([card, youtube, instagram, chzzk])));
    render(<ObservedLiveStrip locale="ko" />);
    await settle();

    expect(screen.getByRole("heading", { name: "지금 LIVE 중" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /ByUs/ })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("link", { name: /YouTube에서 시청, 새 창/ })).toHaveAttribute("href", youtube.watchUrl);
    expect(screen.getByRole("link", { name: /Instagram에서 시청, 새 창/ })).toHaveAttribute("href", instagram.watchUrl);
    expect(screen.getByRole("link", { name: /CHZZK에서 시청, 새 창/ })).toHaveAttribute("href", chzzk.watchUrl);
    expect(screen.getByRole("button", { name: "다음 LIVE" })).toBeInTheDocument();
  });

  it("removes explicit offline targets and cards absent from the current roster", async () => {
    const second: ObservedLiveCard = {
      ...card,
      celebritySlug: "elina",
      creatorName: "엘리나",
      handle: "elina_4_22",
      watchUrl: "https://www.tiktok.com/@elina_4_22/live",
    };
    const endedAt = new Date(start + 30_000).toISOString();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response([card, second]))
      .mockResolvedValue(response([], [targetFor(card, "offline", endedAt)], endedAt)));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    expect(screen.getAllByRole("button", { name: /ByUs/ })).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("shows a collected broadcast and updates its title and cover at the next 30-second poll", async () => {
    const startedAt = new Date(start + 30_000).toISOString();
    const started = { ...card, observedAt: startedAt, expiresAt: new Date(start + 120_000).toISOString() };
    const updatedAt = new Date(start + 60_000).toISOString();
    const updated = { ...started, title: "새 노래", thumbnailUrl: "/images/new-live.jpg", observedAt: updatedAt, expiresAt: new Date(start + 150_000).toISOString() };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response([], [targetFor(card, "offline")]))
      .mockResolvedValueOnce(response([started], [targetFor(started)], startedAt))
      .mockResolvedValue(response([updated], [targetFor(updated)], updatedAt)));
    const { container } = render(<ObservedLiveStrip locale="ko" />); await settle();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /함께 노래해요/ })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /새 노래/ })).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", updated.thumbnailUrl);
  });

  it("keeps the open player mounted when the card roster changes", async () => {
    const second = { ...card, celebritySlug: "elina", creatorName: "엘리나" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([card, second])).mockResolvedValue(response([card])));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    fireEvent.click(screen.getByRole("button", { name: /이퓨.*ByUs/ })); await settle();
    const dialog = screen.getByRole("dialog", { name: "이퓨 LIVE" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("dialog", { name: "이퓨 LIVE" })).toBe(dialog);
    fireEvent.click(screen.getByRole("button", { name: "Close LIVE" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains a fresh card for unavailable and older offline target evidence", async () => {
    const unavailableAt = new Date(start + 30_000).toISOString();
    const oldOfflineAt = new Date(start - 1).toISOString();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([], [targetFor(card, "unavailable", unavailableAt)], unavailableAt))
      .mockResolvedValue(response([], [targetFor(card, "offline", oldOfflineAt)], new Date(start + 60_000).toISOString())));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /ByUs/ })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /ByUs/ })).toBeInTheDocument();
  });

  it("updates the position after a swipe and resets when the visible roster changes", async () => {
    const second = { ...card, celebritySlug: "elina", creatorName: "엘리나" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response([card, second])).mockResolvedValue(response([second])));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    const links = screen.getAllByRole("button", { name: /ByUs/ });
    const grid = links[0].parentElement!;
    Object.defineProperty(links[0], "offsetLeft", { value: 8 });
    Object.defineProperty(links[1], "offsetLeft", { value: 374 });
    fireEvent.scroll(grid, { target: { scrollLeft: 366 } });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getAllByRole("button", { name: /ByUs/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "다음 LIVE" })).not.toBeInTheDocument();
  });

  it("falls back to the creator image when a LIVE cover expires", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ ...card, fallbackThumbnailUrl: "/creator.jpg" }])));
    const { container } = render(<ObservedLiveStrip locale="ko" />); await settle();
    const image = container.querySelector("img")!;
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/creator.jpg");
    fireEvent.error(image);
    expect(image).toHaveStyle({ visibility: "hidden" });
    expect(screen.getByRole("button", { name: /ByUs/ })).toBeInTheDocument();
  });

  it("retains a prior success after 503 only until its original 90-second expiry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(new Response(null, { status: 503 })));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(89_999); });
    expect(screen.getByRole("button", { name: /ByUs/ })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByRole("button", { name: /ByUs/ })).not.toBeInTheDocument();
  });

  it("does not let unsafe or malformed responses erase a fresh card", async () => {
    const unsafe = {
      ...card,
      platform: "youtube" as const,
      watchUrl: "https://evil.example/watch?v=abcDEF123_-",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response([unsafe], [targetFor(unsafe)], new Date(start + 30_000).toISOString()))
      .mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /ByUs/ })).toHaveAttribute("aria-haspopup", "dialog");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("button", { name: /ByUs/ })).toHaveAttribute("aria-haspopup", "dialog");
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
    const invalid = [
      { ...card, celebritySlug: "stale", observedAt: new Date(start - 91_000).toISOString(), expiresAt: new Date(start - 1_000).toISOString() },
      { ...card, celebritySlug: "future", observedAt: new Date(start + 5_000).toISOString(), expiresAt: new Date(start + 95_000).toISOString() },
      { ...card, celebritySlug: "invalid", expiresAt: "invalid" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(invalid)));
    render(<ObservedLiveStrip locale="ko" />); await settle();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
