import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservedLiveCard } from "../domain/observed-live";
import { TikTokLivePlayer } from "./tiktok-live-player";

const library = vi.hoisted(() => ({ createPlayer: vi.fn(), getFeatureList: vi.fn() }));
vi.mock("mpegts.js", () => ({ default: { ...library, LoggingControl: {}, Events: { ERROR: "error" } } }));
const now = Date.parse("2026-09-26T13:00:00Z");
const item: ObservedLiveCard = { platform: "tiktok", celebritySlug: "ifew", creatorName: "이퓨", handle: "ifewknow", title: "함께 노래해요", thumbnailUrl: "/ifew.jpg", watchUrl: "https://www.tiktok.com/@ifewknow/live", observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90_000).toISOString() };
const source = { url: `https://pull-f5-sg01.tiktokcdn.com/live/stream.flv?expire=${now / 1000 + 3600}&sign=test`, roomId: "7689828668055096085", observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() };
const players: { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = [];
const settle = async () => { await act(async () => { await vi.dynamicImportSettled(); }); };
const playing = () => fireEvent.playing(screen.getByLabelText("TikTok LIVE"));

describe("TikTok LIVE playback lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); players.length = 0;
    library.getFeatureList.mockReturnValue({ mseLivePlayback: true });
    library.createPlayer.mockImplementation(() => {
      const player = { destroy: vi.fn(), on: vi.fn(), attachMediaElement: vi.fn(), load: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
      players.push(player); return player;
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ ...source, observedAt: new Date().toISOString() })));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("uses native accessible controls and destroys the stream on close", async () => {
    const { unmount } = render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle();
    const video = screen.getByLabelText("TikTok LIVE");
    expect(video).toHaveAttribute("controls"); expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("disableremoteplayback"); expect(video).toHaveAttribute("tabindex", "0");
    playing(); expect(screen.getByRole("button", { name: "소리 켜고 재생" })).toBeInTheDocument();
    unmount(); expect(players[0].destroy).toHaveBeenCalledOnce();
  });
  it("stops immediately when a fresh check reports ended or restricted", async () => {
    for (const code of [410, 403, 404]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(source)).mockResolvedValue(new Response(null, { status: code })));
      const view = render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
      await settle(); playing();
      const player = players.at(-1)!;
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(player.destroy).toHaveBeenCalledOnce();
      expect(screen.getByRole("status")).toHaveTextContent(code === 410 ? "LIVE가 종료됐어요" : "LIVE를 재생할 수 없어요");
      view.unmount(); vi.setSystemTime(now);
    }
  });
  it("recovers once with a fresh lookup and then requires an explicit retry", async () => {
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle(); playing();
    act(() => players[0].on.mock.calls[0][1]()); await settle(); playing();
    expect(players).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(2);
    act(() => players[1].on.mock.calls[0][1]()); await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
  it("does not resurrect playback when a response arrives after closing", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    const { unmount } = render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle(); const signal = fetcher.mock.calls[0][1].signal;
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json(source))); await settle();
    expect(library.createPlayer).not.toHaveBeenCalled();
  });
  it("replaces a nearly expired source before expiry and replaces changed rooms", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ ...source, expiresAt: new Date(now + 50_000).toISOString() }))
      .mockResolvedValueOnce(Response.json({ ...source, observedAt: new Date(now + 30_000).toISOString() }))
      .mockResolvedValue(Response.json({ ...source, roomId: "7689828668055096086", observedAt: new Date(now + 60_000).toISOString() })));
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle(); playing();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); playing();
    expect(players[0].destroy).toHaveBeenCalledOnce(); expect(players).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(players[1].destroy).toHaveBeenCalledOnce(); expect(players).toHaveLength(3);
  });
  it("stops after 60 seconds without a successful access check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(source)).mockResolvedValue(new Response(null, { status: 503 })));
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle(); playing();
    await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
    expect(players[0].destroy).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(players[0].destroy).toHaveBeenCalledOnce();
  });
  it("retries a failed access check after 10 seconds without interrupting healthy playback", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(source))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementation(async () => Response.json({ ...source, observedAt: new Date().toISOString() }));
    vi.stubGlobal("fetch", fetcher);
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle(); playing();
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(players[0].destroy).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(players).toHaveLength(1);
  });
  it("gives an original link when the browser cannot play live media", async () => {
    library.getFeatureList.mockReturnValue({ mseLivePlayback: false });
    render(<TikTokLivePlayer item={item} locale="en" onClose={() => {}} />); await settle();
    expect(screen.getByRole("status")).toHaveTextContent("This browser cannot play this LIVE");
    expect(screen.getByRole("link", { name: "Watch on TikTok" })).toHaveAttribute("href", item.watchUrl);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts a playback observation within the shared future clock-skew allowance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...source, observedAt: new Date(now + 4_999).toISOString() })));
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle();
    expect(library.createPlayer).toHaveBeenCalledOnce();
  });
  it("uses a compact external-watch fallback after playback fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle();
    expect(screen.getByRole("dialog").className).toContain("compactDialog");
    expect(screen.getByRole("link", { name: "TikTok에서 시청" })).toHaveAttribute("href", item.watchUrl);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
  it("leaves a hanging playback lookup after eight seconds with an external-watch action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    render(<TikTokLivePlayer item={item} locale="ko" onClose={() => {}} />);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByRole("link", { name: "TikTok에서 시청" })).toHaveAttribute("href", item.watchUrl);
    expect(screen.getByRole("dialog").className).toContain("compactDialog");
  });
});
