import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "../../app/pages/ifew-fan-guide/page";
import { sanitizeLiveReturnTo } from "@/features/quiz/domain/live-return-context";
import { ifewEventBanner } from "./content";

vi.mock("@/server/media/guide-images", () => ({ loadGuideImages: vi.fn(async () => ({ celebrity: null, eventPhotos: undefined })) }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));

describe("ifew Saturday LIVE guide", () => {
  it.each(["ko", "en"] as const)("shows the confirmed schedule and separate actions publicly (%s)", async (locale) => {
    const { container } = render(await Page({ searchParams: Promise.resolve({ locale }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(locale === "ko" ? "이퓨의 100일," : "100 days with ifew.");
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-12T08:00:00+09:00");
    expect(container.querySelector("time")).toHaveTextContent("08:00–13:00");
    const actions = locale === "ko" ? ["이퓨 팬 인증하기", "LIVE 예약하기", "TikTok 일정 보기", "뱅크시 관람권 추첨 응모하기", "출석 코드 입력하기"] : ["Verify your ifew fandom", "Reserve a spot", "View the TikTok event", "Enter the Banksy ticket draw", "Enter the attendance code"];
    const destinations = [
      `/c/ifewknow/verify?${new URLSearchParams({ locale, returnTo: `/live/ifew-100-days-tiktok-20260912?locale=${locale}` }).toString()}`,
      `/live/ifew-100-days-tiktok-20260912?locale=${locale}`,
      "https://www.tiktok.com/live/event/7680769355085185044",
      `/c/ifewknow/raffles?locale=${locale}`,
      `/live/ifew-100-days-tiktok-20260912?locale=${locale}#fan-code`,
    ];
    actions.forEach((action, index) => expect(screen.getByRole("link", { name: action })).toHaveAttribute("href", destinations[index]));
    expect(screen.getByRole("link", { name: locale === "ko" ? "뱅크시 티켓 보기" : "View Banksy tickets" })).toHaveAttribute("href", `/c/ifewknow/raffles?locale=${locale}`);
    const returnTo = new URL(destinations[0], "https://byus.kr").searchParams.get("returnTo");
    expect(sanitizeLiveReturnTo(returnTo)).toBe(destinations[1]);
    expect(container.textContent).toContain(locale === "ko" ? "예약·출석만으로 자동 응모되지 않으니 직접 응모해 주세요." : "Reservations and attendance do not enter you automatically.");
    expect(container.textContent).toContain(locale === "ko" ? "5명에게 관람권을 2장씩, 총 10장" : "Five winners receive two admission tickets each, for 10 tickets in total");
    expect(container.textContent).toContain(locale === "ko" ? "더현대 서울" : "The Hyundai Seoul");
    expect(container.textContent).toContain(locale === "ko" ? "9월 20일(일) 00:00 KST" : "September 20 at 00:00 KST");
    expect(container.textContent).not.toMatch(/엘리나|Elina|퀴즈|미션|quiz/i);
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: locale === "ko" ? "Switch to English" : "한국어로 보기" })).toHaveAttribute("href", `/pages/ifew-fan-guide?locale=${locale === "ko" ? "en" : "ko"}`);
  });

  it("shares the localized title, event schedule and image with social previews", async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ locale: "en" }) });
    expect(metadata.title).toBe("100 days with ifew. Let’s celebrate. | ByUs");
    expect(metadata.description).toContain("Sat, Sep 12 · 08:00–13:00 KST");
    expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/ifew-fan-guide?locale=en");
    const socialImages = metadata.openGraph?.images;
    const socialImage = Array.isArray(socialImages) ? socialImages[0] : socialImages;
    const socialImageUrl = typeof socialImage === "object" && "url" in socialImage
      ? socialImage.url.toString()
      : socialImage?.toString() ?? "";
    expect(decodeURIComponent(socialImageUrl)).toContain(ifewEventBanner);
  });

  it("uses Korean for unsupported or repeated locale values", async () => {
    for (const locale of ["fr", ["en", "ko"], undefined]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ locale }) });
      expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/ifew-fan-guide?locale=ko");
    }
  });
});
