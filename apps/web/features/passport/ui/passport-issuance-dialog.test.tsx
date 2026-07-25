import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssuanceAggregate } from "../domain/issuance-aggregate";
import { PassportIssuanceCeremony, PassportIssuanceScreen } from "./passport-issuance-dialog";

const getAccessToken = vi.fn();
let authenticated = true;
let locale = "ko";
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated, getAccessToken }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`locale=${locale}`),
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
    getAccessToken.mockResolvedValue("access-token");
    vi.spyOn(globalThis, "fetch").mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  it("can skip state motion and then reaches the locale-preserving Passport detail route", () => {
    render(<PassportIssuanceCeremony issuance={aggregate} />);
    expect(screen.getByRole("main", { name: "KARA Fan Passport 발급 완료" })).toBeInTheDocument();
    expect(screen.getByText("팬 인증이 완료되어 첫 Stamp와 Passport가 이미 발급되었어요.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ByUs" })).toHaveAttribute("src", expect.stringContaining("byus-wordmark.svg"));
    expect(screen.getByRole("progressbar", { name: "Passport 발급 과정" })).toHaveAttribute("value", "1");
    expect(screen.queryByRole("link", { name: "Passport 열기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByRole("progressbar", { name: "Passport 발급 과정" })).toHaveAttribute("value", "4");
    expect(screen.getByText("팬 인증 Stamp 획득")).toBeInTheDocument();
    expect(screen.getByText("발급 상태 확인 중")).toBeInTheDocument();
    const openPassport = screen.getByRole("link", { name: "Passport 열기" });
    expect(openPassport).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
    expect(openPassport).toHaveFocus();
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
    expect(screen.getByText(String(aggregate.score.points))).toBeInTheDocument();
  });

  it("recovers the same owner-scoped aggregate on direct entry without a mutation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ issuance: aggregate }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    expect(await screen.findByRole("main", { name: "KARA Fan Passport 발급 완료" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      `/api/passports/${aggregate.passport.id}/issuance?locale=ko`,
      expect.objectContaining({ method: "GET", headers: { authorization: "Bearer access-token" } }),
    );
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("keeps Passport access available if ceremony data cannot load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "발급 결과를 불러오지 못했어요." })).toBeInTheDocument());
    expect(screen.getByText("이 화면에서는 Passport를 새로 발급하지 않아요. 내 Passport 화면에서 상태를 다시 확인할 수 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Passport 열기/ })).toHaveAttribute("href", `/passports/${aggregate.passport.id}?locale=ko`);
  });

  it("preserves English locale in direct-entry API and final link", async () => {
    locale = "en";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ issuance: aggregate }));
    render(<PassportIssuanceScreen passportId={aggregate.passport.id} />);

    expect(await screen.findByRole("main", { name: "KARA Fan Passport issued" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      `/api/passports/${aggregate.passport.id}/issuance?locale=en`,
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("link", { name: "Open Passport" })).toHaveAttribute(
      "href",
      `/passports/${aggregate.passport.id}?locale=en`,
    );
  });
});
