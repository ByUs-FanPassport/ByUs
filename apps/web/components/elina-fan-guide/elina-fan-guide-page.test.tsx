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
      title: "좋아하는 마음이, 함께한 순간으로.", verify: "팬 인증하기", live: "LIVE 일정 보기", checkIn: "코드 출석하기", missions: "미션 살펴보기", activity: "활동 인증 보기", prize: "선물 고르기", history: "내 기록 보기",
    } : {
      title: "Turn your fandom into shared moments.", verify: "Verify your fandom", live: "Explore LIVE events", checkIn: "Check in with a code", missions: "Explore missions", activity: "View fan activity", prize: "Choose a prize", history: "View my history",
    };
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(expected.title);
    expect(screen.getAllByRole("link", { name: expected.verify })[0]).toHaveAttribute("href", `/c/elina/verify?locale=${locale}`);
    expect(screen.getByRole("link", { name: expected.live })).toHaveAttribute("href", `/c/elina?tab=live&locale=${locale}#celebrity-content`);
    expect(screen.getByRole("link", { name: expected.checkIn })).toHaveAttribute("href", `/c/elina?tab=live&locale=${locale}#celebrity-content`);
    expect(screen.getByRole("link", { name: expected.missions })).toHaveAttribute("href", `/c/elina?tab=live&locale=${locale}#celebrity-content`);
    expect(screen.getByRole("link", { name: expected.activity })).toHaveAttribute("href", `/c/elina?tab=certifications&locale=${locale}#celebrity-content`);
    expect(screen.getByRole("link", { name: expected.prize })).toHaveAttribute("href", `/c/elina?tab=raffles&locale=${locale}#celebrity-content`);
    expect(screen.getByRole("link", { name: expected.history })).toHaveAttribute("href", `/my?locale=${locale}`);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("form")).toBeNull();
  });

  it("uses URL locale for route content and metadata", async () => {
    const searchParams = Promise.resolve({ locale: "en" });
    render(await Page({ searchParams }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Turn your fandom into shared moments.");
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
