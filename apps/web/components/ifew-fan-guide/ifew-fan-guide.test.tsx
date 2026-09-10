import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page, { generateMetadata } from "../../app/pages/ifew-fan-guide/page";

describe("ifew Saturday LIVE guide", () => {
  it.each(["ko", "en"] as const)("shows the confirmed schedule and separate actions publicly (%s)", async (locale) => {
    const { container } = render(await Page({ searchParams: Promise.resolve({ locale }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(locale === "ko" ? "이퓨의 100일," : "100 days with ifew.");
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-12T08:00:00+09:00");
    expect(container.querySelector("time")).toHaveTextContent("08:00–13:00");
    const actions = locale === "ko" ? ["이퓨 팬 인증하기", "LIVE 예약하기", "TikTok 일정 보기", "뱅크시 티켓 응모하기"] : ["Verify your ifew fandom", "Reserve the LIVE", "View the TikTok event", "Enter the Banksy ticket draw"];
    const destinations = [
      `/c/ifewknow/verify?locale=${locale}`,
      `/live/ifew-100-days-tiktok-20260912?locale=${locale}`,
      "https://www.tiktok.com/live/event/7680769355085185044",
      `/benefits/41ae7883-098e-49f2-9229-4f6962160141?locale=${locale}`,
    ];
    actions.forEach((action, index) => expect(screen.getByRole("link", { name: action })).toHaveAttribute("href", destinations[index]));
    expect(container.textContent).toContain(locale === "ko" ? "예약이나 시청만으로 자동 응모되지 않아요." : "Reserving or watching does not enter you automatically.");
    expect(container.textContent).toContain(locale === "ko" ? "10명에게 티켓을 1장씩" : "Ten winners receive one ticket each");
    expect(container.textContent).toContain(locale === "ko" ? "9월 20일(일) 00:00 KST" : "September 20 at 00:00 KST");
    expect(container.textContent).not.toMatch(/엘리나|Elina|코드 출석|퀴즈|미션|check in with a code|quiz/i);
    expect(container.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: locale === "ko" ? "Switch to English" : "한국어로 보기" })).toHaveAttribute("href", `/pages/ifew-fan-guide?locale=${locale === "ko" ? "en" : "ko"}`);
  });

  it("shares the localized title, event schedule and image with social previews", async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ locale: "en" }) });
    expect(metadata.title).toBe("100 days with ifew. Let’s celebrate. | ByUs");
    expect(metadata.description).toContain("Sat, Sep 12 · 08:00–13:00 KST");
    expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/ifew-fan-guide?locale=en");
    expect(metadata.openGraph?.images).toEqual(expect.arrayContaining([expect.objectContaining({ url: expect.stringContaining("lives/ifew-100-days/banner-") })]));
  });

  it("uses Korean for unsupported or repeated locale values", async () => {
    for (const locale of ["fr", ["en", "ko"], undefined]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ locale }) });
      expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/ifew-fan-guide?locale=ko");
    }
  });
});
