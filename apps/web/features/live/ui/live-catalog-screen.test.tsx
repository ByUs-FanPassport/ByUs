import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveCatalogScreen } from "./live-catalog-screen";

const privy = { ready: true, authenticated: false, getAccessToken: vi.fn() };

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy }));

const base = {
  live: {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "kara-live",
    effectiveStatus: "scheduled" as const,
    startsAt: "2026-09-15T11:00:00.000Z",
    endsAt: "2026-09-15T12:00:00.000Z",
    reservationOpensAt: "2026-07-20T00:00:00.000Z",
    reservationClosesAt: "2026-09-15T11:00:00.000Z",
    title: "KARA × NUALEAF LIVE",
    description: "LIVE",
    productContext: "Brand",
    heroImage: { url: "/images/live.jpg", alt: "KARA LIVE" },
    celebrity: {
      slug: "kara",
      name: "KARA",
      image: "/images/kara.jpg",
      fanCount: 12_800_000,
    },
    brand: { slug: "nualeaf", name: "NUALEAF", logo: "/images/logo.svg", websiteUrl: null },
    watch: { available: false, mode: "unavailable" as const, provider: "youtube" as const, url: "https://youtube.com/live/abc" },
  },
  viewer: { authenticated: false, passport: "missing" as const, reservation: null },
  primaryAction: "sign_in_to_reserve" as const,
};

describe("LIVE catalog", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
    privy.ready = true;
    privy.authenticated = false;
    privy.getAccessToken.mockReset();
  });

  it("refreshes an anonymous catalog at the start and uses the returned LIVE group", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(base.live.startsAt) - 500));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ catalog: {
      liveNow: [{ ...base, live: { ...base.live, effectiveStatus: "live", watch: { ...base.live.watch, available: true, mode: "live" } }, primaryAction: "watch_live" }],
      upcoming: [], replay: [],
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(<LiveCatalogScreen locale="ko" initialCatalog={{ liveNow: [], upcoming: [base], replay: [] }} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(privy.getAccessToken).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "지금 LIVE 중" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "예정된 LIVE" })).queryByRole("article")).not.toBeInTheDocument();
    unmount();
  });

  it("omits only ByUs brand metadata and uses the LIVE start for its countdown", () => {
    const byus = { ...base, live: { ...base.live, id: "byus-event", slug: "byus-event", brand: { ...base.live.brand, name: "ByUs" } } };
    render(<LiveCatalogScreen locale="ko" initialCatalog={{ liveNow: [], upcoming: [byus, base], replay: [] }} />);
    expect(screen.queryByText("KARA · ByUs")).not.toBeInTheDocument();
    expect(screen.getByText("KARA · NUALEAF")).toBeInTheDocument();
    expect(screen.getAllByText(/^D-\d+$/)).toHaveLength(2);
  });

  it("renders the three product states with canonical details", () => {
    const { container } = render(<LiveCatalogScreen locale="ko" initialCatalog={{
      liveNow: [{ ...base, live: { ...base.live, effectiveStatus: "live", watch: { ...base.live.watch, available: true, mode: "live" } }, primaryAction: "watch_live" }],
      upcoming: [base],
      replay: [{ ...base, live: { ...base.live, id: "22222222-2222-4222-8222-222222222222", slug: "kara-replay", effectiveStatus: "ended", watch: { ...base.live.watch, available: true, mode: "replay" } }, primaryAction: "live_ended" }],
    }} />);

    expect(screen.getByRole("heading", { name: "전체 LIVE" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "지금 LIVE 중" })).getByRole("link", { name: /LIVE 시청하기/ })).toHaveAttribute("href", base.live.watch.url);
    const reserveAction = within(screen.getByRole("region", { name: "예정된 LIVE" })).getByRole("link", { name: /라이브 예약하기/ });
    expect(reserveAction).toHaveAttribute("href", "/live/kara-live?locale=ko");
    expect(reserveAction).toHaveAttribute("data-fan-action-emphasis", "secondary");
    expect(reserveAction).toHaveAttribute("data-action-state", "reserve");
    expect(within(reserveAction).getByText("라이브 예약하기")).toBeInTheDocument();
    expect(within(reserveAction).getByText("라이브 예약하기").previousElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(within(screen.getByRole("region", { name: "예정된 LIVE" })).getByRole("link", {
      name: "KARA × NUALEAF LIVE 상세 보기",
    })).toHaveAttribute("href", "/live/kara-live?locale=ko");
    const replayAction = within(screen.getByRole("region", { name: "다시보기" })).getByRole("link", { name: /다시보기/ });
    expect(replayAction).toHaveAttribute("href", base.live.watch.url);
    expect(replayAction).toHaveAttribute("target", "_blank");
    expect(replayAction).toHaveAttribute("rel", "noreferrer");
    expect(container.querySelectorAll('article [data-fan-action-emphasis="secondary"]')).toHaveLength(3);
    expect(container.querySelectorAll('article [data-fan-action-emphasis="primary"]')).toHaveLength(0);
    expect(within(screen.getByRole("region", { name: "예정된 LIVE" })).queryByText("LIVE 예정")).not.toBeInTheDocument();
  });

  it("keeps scheduled actions skeletal until personalized reservation data arrives", async () => {
    privy.authenticated = true;
    privy.getAccessToken.mockResolvedValue("token");
    let resolveCatalog: ((value: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveCatalog = resolve; })));

    render(<LiveCatalogScreen locale="ko" initialCatalog={{ liveNow: [], upcoming: [base], replay: [] }} />);

    expect(screen.getByRole("status", { name: "예약 상태 확인 중" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /라이브 예약하기/ })).not.toBeInTheDocument();

    await waitFor(() => expect(resolveCatalog).toBeDefined());
    resolveCatalog?.(new Response(JSON.stringify({ catalog: {
      liveNow: [],
      upcoming: [{ ...base, viewer: { ...base.viewer, authenticated: true, reservation: { id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-09-04T00:00:00.000Z", stamp: { id: "33333333-3333-4333-8333-333333333333", businessStatus: "issued", mintStatus: "queued" } } } }],
      replay: [],
    } }), { status: 200 }));

    const reservedAction = await screen.findByRole("link", { name: /^상세 보기:/ });
    expect(reservedAction).toHaveAttribute("data-action-state", "reserved");
    expect(reservedAction).toHaveAttribute("data-fan-action-emphasis", "secondary");
    expect(reservedAction).toHaveAttribute("href", "/live/kara-live?locale=ko");
    expect(screen.getByText("예약 완료").closest("a")).not.toBe(reservedAction);
    expect(screen.queryByRole("link", { name: /^예약 완료:/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status", { name: "예약 상태 확인 중" })).not.toBeInTheDocument());

  });

  it("keeps English reservation status separate from its details action and omits empty-section counts", () => {
    const reserved = { ...base, viewer: { ...base.viewer, authenticated: true, reservation: {
      id: "22222222-2222-4222-8222-222222222222", createdAt: "2026-09-04T00:00:00.000Z",
      stamp: { id: "33333333-3333-4333-8333-333333333333", businessStatus: "issued" as const, mintStatus: "queued" as const },
    } } };
    render(<LiveCatalogScreen locale="en" initialCatalog={{ liveNow: [], upcoming: [reserved], replay: [] }} />);
    expect(screen.getByText("Reserved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^View details:/ })).toHaveAttribute("href", "/live/kara-live?locale=en");
    expect(screen.getByRole("link", { name: "LIVE calendar" })).toHaveAttribute("href", "/live/calendar?locale=en");
    expect(screen.queryByRole("link", { name: /^Reserved:/ })).not.toBeInTheDocument();
    const replay = screen.getByRole("region", { name: "Replay" });
    expect(within(replay).getByText("No replays are published yet.")).toBeInTheDocument();
    expect(within(replay).queryByText("0 total")).not.toBeInTheDocument();
    expect(within(replay).queryByText("Revisit published videos from completed LIVE events.")).not.toBeInTheDocument();
  });

  it("does not show a reserved state after personalized status fails and can retry", async () => {
    privy.authenticated = true;
    privy.getAccessToken.mockResolvedValue("token");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ catalog: { liveNow: [], upcoming: [base], replay: [] } }));
    vi.stubGlobal("fetch", fetcher);
    render(<LiveCatalogScreen locale="ko" initialCatalog={{ liveNow: [], upcoming: [base], replay: [] }} />);
    expect(await screen.findByRole("status", { name: "예약 상태 확인 필요" })).toBeInTheDocument();
    expect(screen.queryByText("예약 완료")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내 예약 상태 다시 불러오기" }));
    expect(await screen.findByRole("link", { name: /^라이브 예약하기:/ })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("paginates each LIVE group independently in bounded sets of four", () => {
    const upcoming = Array.from({ length: 5 }, (_, index) => ({
      ...base,
      live: {
        ...base.live,
        id: `upcoming-${index + 1}`,
        slug: `upcoming-${index + 1}`,
        title: `예정 LIVE ${index + 1}`,
      },
    }));
    const replay = Array.from({ length: 5 }, (_, index) => ({
      ...base,
      live: {
        ...base.live,
        id: `replay-${index + 1}`,
        slug: `replay-${index + 1}`,
        title: `다시보기 ${index + 1}`,
        effectiveStatus: "ended" as const,
        watch: { ...base.live.watch, available: true, mode: "replay" as const },
      },
      primaryAction: "live_ended" as const,
    }));

    render(<LiveCatalogScreen locale="ko" initialCatalog={{ liveNow: [], upcoming, replay }} />);

    expect(screen.queryByRole("region", { name: "지금 LIVE 중" })).not.toBeInTheDocument();
    expect(screen.queryByText("현재 진행 중인 LIVE가 없어요.")).not.toBeInTheDocument();
    const upcomingRegion = screen.getByRole("region", { name: "예정된 LIVE" });
    const replayRegion = screen.getByRole("region", { name: "다시보기" });
    expect(within(upcomingRegion).getAllByRole("article")).toHaveLength(4);
    expect(within(replayRegion).getAllByRole("article")).toHaveLength(4);
    expect(within(upcomingRegion).queryByText("예정 LIVE 5")).not.toBeInTheDocument();
    expect(within(replayRegion).queryByText("다시보기 5")).not.toBeInTheDocument();

    fireEvent.click(within(upcomingRegion).getByRole("button", { name: "예정된 LIVE 다음 페이지" }));
    expect(within(upcomingRegion).getByText("예정 LIVE 5")).toBeInTheDocument();
    expect(within(upcomingRegion).getByText("2 / 2")).toBeInTheDocument();
    expect(within(replayRegion).getByText("1 / 2")).toBeInTheDocument();
    expect(within(replayRegion).queryByText("다시보기 5")).not.toBeInTheDocument();
  });
});
