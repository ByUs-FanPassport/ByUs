import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveCatalogScreen } from "./live-catalog-screen";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false, getAccessToken: vi.fn() }),
}));

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
    celebrity: { slug: "kara", name: "KARA", image: "/images/kara.jpg" },
    brand: { slug: "nualeaf", name: "NUALEAF", logo: "/images/logo.svg", websiteUrl: null },
    watch: { available: false, mode: "unavailable" as const, url: "https://youtube.com/live/abc" },
  },
  viewer: { authenticated: false, passport: "missing" as const, reservation: null },
  primaryAction: "sign_in_to_reserve" as const,
};

describe("LIVE catalog", () => {
  it("renders the three product states with canonical details", () => {
    render(<LiveCatalogScreen locale="ko" initialCatalog={{
      liveNow: [{ ...base, live: { ...base.live, effectiveStatus: "live", watch: { ...base.live.watch, available: true, mode: "live" } }, primaryAction: "watch_live" }],
      upcoming: [base],
      replay: [{ ...base, live: { ...base.live, id: "22222222-2222-4222-8222-222222222222", slug: "kara-replay", effectiveStatus: "ended", watch: { ...base.live.watch, available: true, mode: "replay" } }, primaryAction: "live_ended" }],
    }} />);

    expect(screen.getByRole("heading", { name: "모든 LIVE" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "지금 LIVE" })).getByRole("link", { name: /라이브 입장하기/ })).toHaveAttribute("href", base.live.watch.url);
    expect(within(screen.getByRole("region", { name: "다가오는 LIVE" })).getByRole("link", { name: /라이브 예약하기/ })).toHaveAttribute("href", "/live/kara-live?locale=ko");
    expect(within(screen.getByRole("region", { name: "다시보기" })).getByRole("link", { name: /다시보기/ })).toHaveAttribute("href", base.live.watch.url);
  });
});
