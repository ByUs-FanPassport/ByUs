import { APP_LOCALES } from "@/i18n/locales";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BanksyEntryPromotion, BanksyFanBanner, supportsBanksyPromotion } from "./banksy-promotion";
import type { RaffleList } from "@/features/benefit/domain/raffle";

let pathname = "/";
let available: RaffleList["raffles"] = [];
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: ({ fill: _fill, priority: _priority, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => <img alt="" {...props} /> }));
vi.mock("@/features/fanpage/ui/home-panels", () => ({ useCreatorRaffles: () => ({ available }) }));
const raffle: RaffleList["raffles"][number] = { id: "6036dfa3-6fe3-4d6f-aa02-93917af4d8de", benefitId: "fff318a6-24c7-4012-8290-3494a55e287c", title: "뱅크시 전시 티켓", summary: "", imageUrl: null, winnerQuantity: 60, status: "open", entryOpensAt: null, entryClosesAt: "2026-10-07T09:00:00Z", fulfillmentMethod: "on_site_pickup", perFanTicketLimit: null };
beforeEach(() => { pathname = "/"; available = [raffle]; sessionStorage.clear(); });
afterEach(cleanup);

describe("Banksy promotion", () => {
  it("targets discovery pages without interrupting authentication, account, entry or mission flows", () => {
    for (const path of ["/", "/elina", "/c/elina", "/celebrities", "/live", "/live/elina-banksy-instagram-20260918", "/pages/elina-fan-guide"]) expect(supportsBanksyPromotion(path, "")).toBe(true);
    for (const path of ["/login", "/admin", "/my", "/onboarding/profile", "/c/elina/raffles", "/c/elina/verify", "/live/elina/missions", "/pages/terms"]) expect(supportsBanksyPromotion(path, "")).toBe(false);
    for (const query of ["authIntent=abc", "intent=passport", "returnTo=/my", "tab=raffles", "tab=certifications"]) expect(supportsBanksyPromotion("/elina", query)).toBe(false);
  });
  it("shows the configured count and deadline in both languages, linking to the raffle catalog", () => {
    for (const locale of ["ko", "en"] as const) {
      const view = render(<BanksyFanBanner available={[{ ...raffle, winnerQuantity: 42 }]} locale={locale} />);
      expect(screen.getByText(locale === "ko" ? "42명 추첨" : "42 winners")).toBeVisible();
      expect(screen.getByText("2026.10.07 18:00 (KST)")).toHaveAttribute("datetime", raffle.entryClosesAt);
      expect(screen.getByRole("link")).toHaveAttribute("href", `/c/elina/raffles?locale=${locale}`);
      view.unmount();
    }
  });
  it.each(APP_LOCALES.filter(locale => locale !== "ko" && locale !== "en"))("keeps %s on campaign links and translates its copy", locale => {
    const view = render(<BanksyFanBanner available={[{ ...raffle, winnerQuantity: 42 }]} locale={locale} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `/c/elina/raffles?locale=${locale}`);
    expect(screen.getByRole("link")).not.toHaveTextContent("Explore the giveaway");
    expect(view.container).toHaveTextContent("42");
    expect(view.container).not.toHaveTextContent("{0}");
    view.unmount();
  });
  it("does not promote an empty, ended or unrelated campaign", () => {
    const view = render(<BanksyFanBanner available={[]} locale="ko" />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<BanksyFanBanner available={[{ ...raffle, benefitId: "81fc87bf-5264-43dd-ba08-95cf2ffc949b" }]} locale="ko" />);
    expect(view.container).toBeEmptyDOMElement();
    available = [];
    render(<BanksyEntryPromotion />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("waits for other dialogs, closes with Escape, and stays dismissed across navigation", async () => {
    const blocker = document.createElement("div");
    blocker.setAttribute("role", "dialog"); document.body.append(blocker);
    const view = render(<BanksyEntryPromotion />);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    blocker.remove();
    const dialog = await screen.findByRole("dialog", { name: /뱅크시를 만나는/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("link", { name: "이벤트 응모하러 가기" })).toHaveAttribute("href", "/c/elina/raffles?locale=ko");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    pathname = "/elina"; view.rerender(<BanksyEntryPromotion />);
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("byus:banksy-promotion:202609:v1")).toBe("seen");
  });
});
