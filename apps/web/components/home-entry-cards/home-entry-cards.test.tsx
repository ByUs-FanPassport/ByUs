import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElinaGuideCard, HomeEntryCards } from "./home-entry-cards";
import { HomeGuideCarousel } from "./home-guide-carousel";
import type { ComponentProps } from "react";

vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), null] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));

const advance = (ms = 3_000) => act(() => { vi.advanceTimersByTime(ms); });
const pointerEnter = (element: HTMLElement, pointerType: string) => {
  const event = createEvent.pointerOver(element);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
};
const activeLink = () => document.querySelector('[data-active="true"] a');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("home entry cards", () => {
  it.each(["ko", "en"] as const)("makes each complete card one localized link (%s)", (locale) => {
    const { container } = render(<HomeEntryCards celebrities={[]} locale={locale} />);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/c/elina/raffles?locale=${locale}`);
    expect(links[1]).toHaveAttribute("href", `/pages/us-fanmeetings?locale=${locale}`);
    expect(links[0].querySelector("strong")).not.toBeNull();
    expect(container.querySelector("a a, a button")).toBeNull();
    expect(container.querySelector('a[href*="ifew"], button')).toBeNull();
    expect(container.textContent).not.toMatch(/100일|100-day/);
  });

  it.each([
    ["ko", "엘리나와 함께 뱅크시 전시 보러 가요", "팬 인증하고 응모권을 받아 원하는 선물에 응모하세요.", "이벤트 응모하기"],
    ["en", "See Banksy with Elina", "Verify fandom, get tickets, and enter for a prize.", "Enter the raffle"],
    ["ja", "Elinaと一緒にバンクシー展へ行こう", "ファン認証で応募券を受け取り、好きな賞品に応募しましょう。", "抽選に応募する"],
    ["zh-Hans", "和 Elina 一起去看班克斯展览", "完成粉丝认证，领取抽奖券，参与心仪奖品的抽奖。", "参加活动抽奖"],
    ["zh-Hant", "和 Elina 一起去看班克斯展覽", "完成粉絲認證，領取抽獎券，參加心儀獎品的抽獎。", "參加活動抽獎"],
    ["es", "Ve a la exposición de Banksy con Elina", "Verifica que eres fan, recibe boletos y participa por un regalo.", "Participar en el sorteo"],
    ["id", "Lihat pameran Banksy bersama Elina", "Verifikasi penggemar, dapatkan tiket, lalu ikuti undian hadiah.", "Ikuti undian"],
    ["vi", "Đi xem triển lãm Banksy cùng Elina", "Xác minh người hâm mộ, nhận vé và tham gia rút thăm quà.", "Tham gia rút thăm"],
    ["th", "ไปชมนิทรรศการ Banksy กับ Elina", "ยืนยันสถานะแฟน รับสิทธิ์ลุ้นรางวัล แล้วร่วมลุ้นของขวัญที่คุณชอบ", "เข้าร่วมกิจกรรมชิงรางวัล"],
    ["pt", "Veja a exposição de Banksy com Elina", "Verifique seu perfil de fã, receba bilhetes e concorra ao seu presente favorito.", "Participar do sorteio"],
    ["fr", "Découvrez l’exposition Banksy avec Elina", "Validez votre statut de fan et utilisez vos tickets pour tenter de gagner un cadeau.", "Participer au tirage au sort"],
  ] as const)("uses the Banksy raffle copy in %s", (locale, title, description, action) => {
    const { container } = render(<HomeEntryCards celebrities={[]} locale={locale} />);
    expect(container).toHaveTextContent(title);
    expect(container).toHaveTextContent(description);
    expect(container).toHaveTextContent(action);
    expect(container).toHaveTextContent("ELINA × BANKSY");
  });

  it("uses the same raffle message and destination in the hero and sidebar card", () => {
    const { container } = render(<>
      <ElinaGuideCard locale="ko" elina={undefined} hero />
      <ElinaGuideCard locale="ko" elina={undefined} />
    </>);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/c/elina/raffles?locale=ko");
    }
    const cards = [container.querySelector("[data-home-hero-banner]"), links[1]];
    for (const card of cards) {
      expect(card).toHaveTextContent("엘리나와 함께 뱅크시 전시 보러 가요");
      expect(card).toHaveTextContent("팬 인증하고 응모권을 받아 원하는 선물에 응모하세요.");
      expect(card).toHaveTextContent("이벤트 응모하기");
      expect(card).toHaveTextContent("ELINA × BANKSY");
    }
  });
});

// Keep the reusable carousel behavior covered independently of retired campaigns.
function GuideCarouselFixture() {
  return <HomeGuideCarousel locale="en" slides={[
    { key: "first", label: "First guide", content: <a href="/first">First guide</a> },
    { key: "second", label: "Second guide", content: <a href="/second">Second guide</a> },
  ]} />;
}

describe("home guide carousel", () => {

  it("automatically rotates and loops", () => {
    render(<GuideCarouselFixture />);
    advance(2_999); expect(activeLink()).toHaveAttribute("href", "/first");
    advance(1); expect(activeLink()).toHaveAttribute("href", "/second");
    advance(); expect(activeLink()).toHaveAttribute("href", "/first");
  });

  it("pauses on hover and requires explicit restart after keyboard focus leaves", () => {
    render(<GuideCarouselFixture />);
    const root = screen.getByRole("region");
    pointerEnter(root, "mouse"); advance();
    expect(activeLink()).toHaveAttribute("href", "/first");
    fireEvent.pointerLeave(root); advance();
    expect(activeLink()).toHaveAttribute("href", "/second");
    fireEvent.focus(activeLink()!); fireEvent.blur(activeLink()!); advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/second");
    fireEvent.click(screen.getByRole("button", { name: "Start autoplay" })); advance();
    expect(activeLink()).toHaveAttribute("href", "/first");
  });

  it("does not leave touch playback stuck in a mouse hover pause", () => {
    render(<GuideCarouselFixture />);
    pointerEnter(screen.getByRole("region"), "touch");
    const pause = screen.getByRole("button", { name: "Pause autoplay" });
    fireEvent.pointerDown(pause); fireEvent.focus(pause); fireEvent.click(pause);
    advance();
    expect(activeLink()).toHaveAttribute("href", "/first");
    fireEvent.pointerDown(pause); fireEvent.click(pause); advance();
    expect(activeLink()).toHaveAttribute("href", "/second");
  });

  it("preserves a pointer pause when the same click also focuses the rotation button", () => {
    render(<GuideCarouselFixture />);
    const pause = screen.getByRole("button", { name: "Pause autoplay" });
    fireEvent.pointerDown(pause); fireEvent.focus(pause); fireEvent.click(pause);
    advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/first");
    fireEvent.click(screen.getByRole("button", { name: "Start autoplay" })); advance();
    expect(activeLink()).toHaveAttribute("href", "/second");
  });

  it("suspends offscreen and hidden-page timers and cleans them up on unmount", () => {
    let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() { intersect([{ isIntersecting: true }]); }
      disconnect = disconnect;
    });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const view = render(<GuideCarouselFixture />);
    act(() => intersect([{ isIntersecting: false }])); advance();
    expect(activeLink()).toHaveAttribute("href", "/first");
    expect(vi.getTimerCount()).toBe(0);
    act(() => intersect([{ isIntersecting: true }]));
    hidden.mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange")); advance();
    expect(activeLink()).toHaveAttribute("href", "/second");
    view.unmount(); expect(disconnect).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("respects reduced motion and keeps manual navigation available", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<GuideCarouselFixture />);
    advance(12_000);
    expect(activeLink()).toHaveAttribute("href", "/first");
    expect(screen.getByRole("button", { name: "Start autoplay" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next guide" }));
    expect(activeLink()).toHaveAttribute("href", "/second");
  });
});
