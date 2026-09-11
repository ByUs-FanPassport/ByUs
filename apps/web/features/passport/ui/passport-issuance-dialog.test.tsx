import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssuanceAggregate } from "../domain/issuance-aggregate";
import { PassportIssuanceCeremony, PassportIssuanceScreen } from "./passport-issuance-dialog";

const getAccessToken = vi.fn();
let authenticated = true;
let locale = "ko";
let returnTo: string | null = null;
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => {
    const params = new URLSearchParams({ locale });
    if (returnTo) params.set("returnTo", returnTo);
    return params;
  },
}));

const aggregate: IssuanceAggregate = {
  passport: { id: "20000000-0000-4000-8000-000000000002", businessStatus: "issued", mintStatus: "processing", tokenId: null, issuedAt: "2026-07-21T05:00:00+00:00" },
  celebrity: { slug: "kara", name: "KARA", image: { url: "/kara.jpg", alt: "KARA", position: "center" } },
  firstStamp: { type: "knowledge", businessStatus: "issued", mintStatus: "retryable", tokenId: null, issuedAt: "2026-07-21T05:00:00+00:00" },
  score: { points: 1 },
};

describe("PassportIssuanceCeremony", () => {
  beforeEach(() => {
    authenticated = true;
    locale = "ko";
    returnTo = null;
    getAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch").mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("can skip state motion and then reaches the locale-preserving Passport detail route", () => {
    render(<PassportIssuanceCeremony issuance={aggregate} />);
    expect(screen.getByRole("main", { name: "KARA Passport 발급 완료" })).toBeInTheDocument();
    expect(screen.getByText("첫 팬 인증 Stamp와 팬 점수 +1이 기록됐어요.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ByUs" })).toHaveAttribute("src", expect.stringContaining("byus-wordmark.svg"));
    expect(screen.getByRole("progressbar", { name: "Passport 발급 과정" })).toHaveAttribute("value", "1");
    expect(screen.queryByRole("link", { name: "Passport 열기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByRole("progressbar", { name: "Passport 발급 과정" })).toHaveAttribute("value", "4");
    expect(screen.getByText("팬 인증 Stamp 획득")).toBeInTheDocument();
    expect(screen.getByText("발급 상태 확인 중")).toBeInTheDocument();
    const openPassport = screen.getByRole("link", { name: "Passport 열기" });
    expect(openPassport).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
    expect(screen.getByText(/내 Passport는 MY에서 다시 볼 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MY에서 보기" })).toHaveAttribute("href", "/my?locale=ko");
    expect(openPassport).toHaveFocus();
  });

  it("offers an explicit return to the original LIVE after issuance completes", () => {
    const liveReturnTo = "/live/kara-seoul?locale=ko&authIntent=abcdefab-1234-4123-8123-abcdefabcdef";
    render(<PassportIssuanceCeremony issuance={aggregate} returnTo={liveReturnTo} />);

    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByRole("link", { name: "LIVE 예약 이어가기" })).toHaveAttribute("href", liveReturnTo);
    expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
    expect(screen.getByRole("link", { name: "MY에서 보기" })).toHaveAttribute("href", "/my?locale=ko");
  });

  it("ignores an unsafe LIVE target and keeps the normal Passport action", () => {
    render(<PassportIssuanceCeremony issuance={aggregate} returnTo="//evil.example/live/kara?locale=ko" />);
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));

    expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveAttribute(
      "href",
      `/passports/${aggregate.passport.id}?locale=ko`,
    );
  });

  it("uses Skip only to complete the local presentation and exposes no issuance mutation", () => {
    render(<PassportIssuanceCeremony issuance={aggregate} />);

    expect(screen.getByRole("button", { name: "건너뛰기" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Passport 열기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.queryByRole("button", { name: "건너뛰기" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Passport 열기" })).toBeInTheDocument();
  });

  it("moves focus to the final action when automatic completion removes a focused Skip button", () => {
    vi.useFakeTimers();
    render(<PassportIssuanceCeremony issuance={aggregate} />);

    screen.getByRole("button", { name: "건너뛰기" }).focus();
    expect(screen.getByRole("button", { name: "건너뛰기" })).toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(1_350);
    });

    expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveFocus();
    vi.useRealTimers();
  });

  it("keeps the completed screen stable after Skip while earlier animation timers finish", () => {
    vi.useFakeTimers();
    render(<PassportIssuanceCeremony issuance={aggregate} />);
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    for (const elapsed of [450, 450, 450]) {
      act(() => vi.advanceTimersByTime(elapsed));
      expect(screen.getByRole("link", { name: "Passport 열기" })).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("value", "4");
    }
    vi.useRealTimers();
  });

  it.each(["queued", "processing", "minted", "retryable", "permanent_failure"] as const)("separates usable Passport access from %s digital issuance", (mintStatus) => {
    render(<PassportIssuanceCeremony issuance={{ ...aggregate, passport: { ...aggregate.passport, mintStatus, tokenId: mintStatus === "minted" ? "1" : null }, firstStamp: { ...aggregate.firstStamp, mintStatus, tokenId: mintStatus === "minted" ? "2" : null } }} />);
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByText("Passport는 지금 사용할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByText("이번 인증으로 받은 점수")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("시작 등급")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
  });

  it("restores the large data-driven Stamp impact before settling the record into the first Passport slot", () => {
    vi.useFakeTimers();
    const { container } = render(<PassportIssuanceCeremony issuance={aggregate} />);

    expect(container.querySelector("[data-issuance-stamp-moment]")).toBeNull();
    expect(container.querySelectorAll('[data-passport-stamp="knowledge"]')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(450);
    });
    const impact = container.querySelector("[data-issuance-stamp-moment]");
    expect(impact).toHaveAttribute("data-state", "impact");
    expect(screen.getByRole("img", { name: /KARA 팬 인증 Stamp.*1점 획득/ })).toBeInTheDocument();
    expect(impact).toHaveTextContent("팬 인증");
    expect(impact).toHaveTextContent("VERIFIED");
    expect(impact).toHaveTextContent("+1");
    expect(container.querySelectorAll('[data-passport-stamp="knowledge"]')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(container.querySelector("[data-issuance-stamp-moment]")).toHaveAttribute("data-state", "settling");
    expect(container.querySelectorAll('[data-passport-stamp="knowledge"]')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(container.querySelector("[data-issuance-stamp-moment]")).toBeNull();
    expect(container.querySelectorAll('[data-passport-stamp="knowledge"]')).toHaveLength(1);
    vi.useRealTimers();
  });

  it("keeps completion copy outside the Passport artwork and maps values to its printed fields", () => {
    const { container } = render(<PassportIssuanceCeremony issuance={aggregate} />);

    const title = screen.getByRole("heading", { name: "KARA Passport 발급 완료" });
    const passport = container.querySelector("section[aria-label='KARA Fan Passport']");
    expect(passport).not.toContainElement(title);
    expect(container.querySelector("[data-passport-field='star']")).toHaveTextContent("KARA");
    expect(container.querySelector("[data-passport-field='issue-date']")).toHaveTextContent("2026");
    expect(container.querySelector("[data-passport-field='fan-id']")).toHaveTextContent("20000000…0002");
  });

  it("copies the full Passport ID while showing only the stable shortened value", async () => {
    render(<PassportIssuanceCeremony issuance={aggregate} />);

    expect(screen.getAllByText("20000000…0002")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "전체 Fan ID 복사" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(aggregate.passport.id));
    expect(screen.getByText("Fan ID를 복사했어요.")).toBeInTheDocument();
  });

  it("localizes the verification seal without baking Korean copy into English", () => {
    vi.useFakeTimers();
    render(<PassportIssuanceCeremony issuance={aggregate} locale="en" />);
    act(() => {
      vi.advanceTimersByTime(450);
    });

    const seal = screen.getByRole("img", { name: /KARA Fan Verification Stamp.*1 point earned/ });
    expect(seal).toHaveTextContent("FAN");
    expect(seal).toHaveTextContent("VERIFIED");
    expect(seal).not.toHaveTextContent("팬 인증");
    vi.useRealTimers();
  });

  it("keeps Passport access available when the base artwork fails", () => {
    const { container } = render(<PassportIssuanceCeremony issuance={aggregate} />);
    const passportImage = container.querySelector('img[src*="passport-open-blank-9-transparent"]');
    expect(passportImage).not.toBeNull();
    fireEvent.error(passportImage!);
    expect(screen.getByRole("status")).toHaveTextContent("Passport 이미지를 불러오지 못했어요.");
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByRole("link", { name: "Passport 열기" })).toBeInTheDocument();
  });

  it("shows the completed static result immediately for reduced-motion users", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    render(<PassportIssuanceCeremony issuance={aggregate} />);

    expect(await screen.findByRole("link", { name: "Passport 열기" })).toHaveAttribute(
      "href",
      `/passports/${aggregate.passport.id}?locale=ko`,
    );
    expect(screen.getByText(`+${aggregate.score.points}`)).toBeInTheDocument();
  });

  it("recovers the same owner-scoped aggregate on direct entry without a mutation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ issuance: aggregate }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    expect(await screen.findByRole("main", { name: "KARA Passport 발급 완료" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      `/api/passports/${aggregate.passport.id}/issuance?locale=ko`,
      expect.objectContaining({ method: "GET", headers: { authorization: "Bearer access-token" } }),
    );
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("preserves the LIVE return when issuance requires login again", async () => {
    authenticated = false;
    returnTo = "/live/kara-seoul?locale=ko";
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    const issuanceReturnTo = `/passports/${aggregate.passport.id}/issuance?locale=ko&returnTo=${encodeURIComponent(returnTo)}`;
    expect(await screen.findByRole("link", { name: "로그인하고 발급 결과 확인하기" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent(issuanceReturnTo)}&locale=ko&intent=passport&entity=${aggregate.passport.id}`,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps Passport access available if ceremony data cannot load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "발급 결과를 불러오지 못했어요." })).toBeInTheDocument());
    expect(screen.getByText("잠시 후 다시 확인하거나, 내 Passport를 열어보세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Passport 열기/ })).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
  });

  it("preserves English locale in direct-entry API and final link", async () => {
    locale = "en";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ issuance: aggregate }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    expect(await screen.findByRole("main", { name: "KARA Passport issued" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      `/api/passports/${aggregate.passport.id}/issuance?locale=en`,
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("link", { name: "Open Passport" })).toHaveAttribute(
      "href",
      `/passports/${aggregate.passport.id}?locale=en`,
    );
    expect(screen.getByRole("link", { name: "View in MY" })).toHaveAttribute("href", "/my?locale=en");
  });
});
