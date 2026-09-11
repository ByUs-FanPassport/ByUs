import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElinaMissionEntry } from "./elina-mission-entry";

function publicLivePayload(missionsAvailable: boolean | null | "omitted" = true) {
  return {
    live: {
      id: "c0960f8b-f01c-4308-97f8-3d13173922e8",
      slug: "elina-banksy-instagram-20260918",
      effectiveStatus: "scheduled",
      startsAt: "2026-09-18T10:00:00.000Z",
      endsAt: "2026-09-18T11:00:00.000Z",
      reservationOpensAt: "2026-09-11T00:00:00.000Z",
      reservationClosesAt: "2026-09-18T10:00:00.000Z",
      title: "Elina × Banksy LIVE",
      description: "엘리나와 함께 뱅크시 작품을 만나 봐요.",
      productContext: "LIVE 참여",
      heroImage: { url: "/images/elina-live.webp", alt: "Elina LIVE" },
      celebrity: { slug: "elina", name: "Elina", image: "/images/elina.webp", fanCount: 0 },
      brand: { slug: "banksy", name: "Banksy", logo: "/images/banksy.webp", websiteUrl: null },
      watch: { available: false, provider: "instagram", url: "https://www.instagram.com/elina/" },
      ...(missionsAvailable === "omitted" ? {} : { missionsAvailable }),
    },
    viewer: { authenticated: false, passport: "missing", reservation: null },
    primaryAction: "sign_in_to_reserve",
  };
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ElinaMissionEntry", () => {
  it("shows the Korean entry only when the public live response explicitly exposes missions", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => response(publicLivePayload(true)));
    vi.stubGlobal("fetch", fetcher);
    render(<ElinaMissionEntry celebritySlug="elina" locale="ko" />);

    expect(await screen.findByRole("heading", { name: "엘리나와 뱅크시 한 작품" })).toBeInTheDocument();
    expect(screen.getByText("마음에 드는 작품을 고르고, 그림 속 디테일도 찾아봐요.")).toBeInTheDocument();
    expect(screen.getByText("투표 1개 · 퀴즈 1개")).toBeInTheDocument();
    expect(screen.getByText("작품을 고르고 스탬프를 남겨요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "미션 시작하기" })).toHaveAttribute(
      "href",
      "/live/elina-banksy-instagram-20260918/missions?locale=ko",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/live-events/elina-banksy-instagram-20260918?locale=ko",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("preserves English copy and locale in the public request and mission route", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => response(publicLivePayload(true)));
    vi.stubGlobal("fetch", fetcher);
    render(<ElinaMissionEntry celebritySlug="elina" locale="en" />);

    expect(await screen.findByRole("heading", { name: "Elina and Banksy, one artwork" })).toBeInTheDocument();
    expect(screen.getByText("Pick your favorite artwork, then look for a detail in the picture.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start missions" })).toHaveAttribute(
      "href",
      "/live/elina-banksy-instagram-20260918/missions?locale=en",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/live-events/elina-banksy-instagram-20260918?locale=en");
  });

  it.each([
    ["false", publicLivePayload(false), 200],
    ["unknown", publicLivePayload("omitted"), 200],
    ["invalid", { live: { missionsAvailable: true } }, 200],
    ["failure", {}, 503],
  ] as const)("stays hidden for a %s public state", async (_state, body, status) => {
    vi.stubGlobal("fetch", vi.fn(() => response(body, status)));
    render(<ElinaMissionEntry celebritySlug="elina" locale="ko" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "엘리나와 뱅크시 한 작품" })).not.toBeInTheDocument();
  });

  it("does not request or render the entry on another celebrity page", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<ElinaMissionEntry celebritySlug="kara" locale="ko" />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it.each([
    ["live event", { live: { slug: "another-live" } }],
    ["celebrity", { live: { celebrity: { slug: "kara" } } }],
  ] as const)("rejects a public payload for a different %s", async (_identity, override) => {
    const payload = publicLivePayload(true);
    const mismatched = {
      ...payload,
      live: {
        ...payload.live,
        ...override.live,
        celebrity: { ...payload.live.celebrity, ...("celebrity" in override.live ? override.live.celebrity : {}) },
      },
    };
    vi.stubGlobal("fetch", vi.fn(() => response(mismatched)));
    render(<ElinaMissionEntry celebritySlug="elina" locale="ko" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "엘리나와 뱅크시 한 작품" })).not.toBeInTheDocument();
  });

  it("aborts the public visibility request when the entry unmounts", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<ElinaMissionEntry celebritySlug="elina" locale="ko" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0]?.[1]?.signal as AbortSignal;

    view.unmount();

    expect(signal.aborted).toBe(true);
  });
});
