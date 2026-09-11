import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "../../app/pages/elina-fan-guide/page";
import { ElinaFanGuidePage } from "./elina-fan-guide-page";

vi.mock("@/server/media/guide-images", () => ({ loadGuideImages: vi.fn(async () => ({ celebrity: null, eventPhotos: undefined })) }));

describe("Elina fan guide", () => {
  it.each(["ko", "en"] as const)("renders approved %s copy and real action destinations", (locale) => {
    const { container } = render(<ElinaFanGuidePage locale={locale} images={{ celebrity: null, eventPhotos: undefined }} />);
    const expected = locale === "ko" ? {
      title: "엘리나와 함께하는 뱅크시 LIVE", verify: "팬 인증하기", live: "엘리나 LIVE 예약하기", checkIn: "출석할 LIVE 화면 보기", prize: "선물 고르고 응모하기", history: "내 기록 보기", start: "팬 인증하고 시작하기", prizes: "경품 3종 보기",
    } : {
      title: "Banksy LIVE with Elina", verify: "Verify your fandom", live: "Reserve Elina’s LIVE", checkIn: "Open the LIVE check-in page", prize: "Choose a prize and enter", history: "View my history", start: "Verify and get started", prizes: "View all 3 prizes",
    };
    const liveHref = `/live/elina-banksy-instagram-20260918?locale=${locale}`;
    const verifyHref = `/c/elina/verify?${new URLSearchParams({ locale, returnTo: liveHref })}`;
    const raffleHref = `/c/elina/raffles?locale=${locale}`;
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(expected.title);
    expect(screen.getByRole("link", { name: expected.verify })).toHaveAttribute("href", verifyHref);
    expect(screen.getAllByRole("link", { name: expected.start })[0]).toHaveAttribute("href", verifyHref);
    expect(screen.getByRole("link", { name: expected.live })).toHaveAttribute("href", liveHref);
    expect(screen.getByRole("link", { name: expected.checkIn })).toHaveAttribute("href", `${liveHref}#fan-code`);
    expect(screen.getByRole("link", { name: expected.prize })).toHaveAttribute("href", raffleHref);
    expect(screen.getByRole("link", { name: expected.prizes })).toHaveAttribute("href", raffleHref);
    expect(screen.getByRole("link", { name: expected.history })).toHaveAttribute("href", `/my?locale=${locale}`);
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-09-18T20:30:00+09:00");
    expect(container.textContent).not.toMatch(/미션|멤버십|설문|missions|membership|survey/i);
    expect(container.textContent).toContain(locale === "ko" ? "방송까지 기다릴 필요 없어요." : "No need to wait for the broadcast.");
    expect(container.textContent).toContain(locale === "ko" ? "처음 완료할 때" : "granted once");
    expect(container.textContent).toContain(locale === "ko" ? "60명" : "60 exhibition");
    expect(container.textContent).toContain(locale === "ko" ? "비피오 랜덤 케이스 10명" : "10 Beepio random case");
    expect(container.textContent).toContain(locale === "ko" ? "뱅크시 한정판 스태츄 3명" : "3 Banksy limited-edition statue");
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("form")).toBeNull();
  });

  it("uses URL locale for route content and metadata", async () => {
    const searchParams = Promise.resolve({ locale: "en" });
    render(await Page({ searchParams }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Banksy LIVE with Elina");
    const metadata = await generateMetadata({ searchParams });
    expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/elina-fan-guide?locale=en");
  });

  it("falls back to Korean for unsupported or repeated locale values", async () => {
    for (const locale of ["fr", ["en", "ko"], undefined]) {
      const metadata = await generateMetadata({ searchParams: Promise.resolve({ locale }) });
      expect(metadata.alternates?.canonical).toBe("https://byus.kr/pages/elina-fan-guide?locale=ko");
    }
  });
});
