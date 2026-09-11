import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceGuidePage } from "./service-guide-page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/guide",
  useSearchParams: () => new URLSearchParams("locale=ko"),
}));

describe("ServiceGuidePage", () => {
  beforeEach(() => window.history.replaceState({}, "", "/guide?locale=ko"));

  it("keeps verification, reservation, attendance, and prize entry separate in Korean", () => {
    const { container } = render(<ServiceGuidePage locale="ko" />);
    const main = screen.getByRole("main");

    expect(within(main).getByRole("heading", { level: 1, name: "팬 활동을 시작하는 방법" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { name: "최애를 찾고 팬 인증하기" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { name: "LIVE 예약하기" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { name: "LIVE에 출석하기" })).toBeInTheDocument();
    expect(within(main).getByRole("heading", { name: "선물에 따로 응모하기" })).toBeInTheDocument();
    expect(main).toHaveTextContent("예약이나 출석만으로 자동 응모되지 않아요");
    expect(main).toHaveTextContent("배송 가능 국가");
    expect(screen.getByRole("link", { name: "최애 찾기" })).toHaveAttribute("href", "/celebrities?locale=ko");
    expect(within(main).getByRole("link", { name: "문의하기" })).toHaveAttribute("href", "/my/inquiries?locale=ko");

    const jsonLd = container.querySelector("#byus-guide-faq-structured-data");
    expect(jsonLd).toHaveAttribute("type", "application/ld+json");
    const data = JSON.parse(jsonLd?.textContent ?? "");
    expect(data["@type"]).toBe("FAQPage");
    expect(data.mainEntity).toHaveLength(6);
    expect(data.mainEntity[0].name).toBe("팬 인증, LIVE 예약, 출석, 선물 응모는 한 번에 처리되나요?");
  });

  it("publishes the same participation boundaries and locale links in English", () => {
    render(<ServiceGuidePage locale="en" />);
    const main = screen.getByRole("main");

    expect(within(main).getByRole("heading", { level: 1, name: "Start your fan journey" })).toBeInTheDocument();
    expect(main).toHaveTextContent("A reservation does not count as attendance");
    expect(main).toHaveTextContent("does not enter you automatically");
    expect(main).toHaveTextContent("Access to the service does not guarantee eligibility for every event");
    expect(screen.getByRole("link", { name: "Find favorites" })).toHaveAttribute("href", "/celebrities?locale=en");
    expect(screen.getByRole("link", { name: "View LIVE schedule" })).toHaveAttribute("href", "/live?locale=en");
  });
});
