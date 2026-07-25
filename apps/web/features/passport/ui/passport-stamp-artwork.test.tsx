import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PassportStampCanvas, StampArtwork, type PassportStampRecord } from "./passport-stamp-artwork";
import { STAMP_METADATA, stampTypeLabel } from "../domain/passport-read-model";

describe("Passport Stamp artwork", () => {
  it("uses brand-neutral, text-labelled artwork rather than celebrity-specific image assets", () => {
    const { container } = render(
      <StampArtwork type="knowledge" locale="ko" />,
    );

    expect(screen.getByRole("img", { name: "팬 인증 Stamp" })).toBeInTheDocument();
    expect(screen.getByText("인증")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/kara|nualeaf/i);
  });

  it("uses the shared domain labels, short labels, and ink tokens for every Stamp", () => {
    const { container } = render(
      <>
        <StampArtwork type="reservation" locale="en" />
        <StampArtwork type="survey" locale="ko" />
      </>,
    );
    const reservation = screen.getByRole("img", { name: `${stampTypeLabel("en", "reservation")} Stamp` });
    const survey = screen.getByRole("img", { name: `${stampTypeLabel("ko", "survey")} Stamp` });
    expect(reservation).toHaveTextContent(STAMP_METADATA.reservation.shortLabel.en);
    expect(reservation).toHaveStyle({ "--stamp-ink": STAMP_METADATA.reservation.inkToken });
    expect(survey).toHaveTextContent(STAMP_METADATA.survey.shortLabel.ko);
    expect(survey).toHaveStyle({ "--stamp-ink": STAMP_METADATA.survey.inkToken });
    expect(container.innerHTML).not.toContain("LIVE Reservation");
  });

  it("keeps duplicate Stamp records and places every earned record in its own slot", () => {
    const stamps: PassportStampRecord[] = [
      { id: "one", type: "knowledge", issuedAt: "2026-07-20T00:00:00.000Z" },
      { id: "two", type: "knowledge", issuedAt: "2026-07-21T00:00:00.000Z" },
      { id: "three", type: "knowledge", issuedAt: "2026-07-22T00:00:00.000Z" },
    ];
    const { container } = render(
      <PassportStampCanvas
        celebrityName="Elina"
        level="브론즈"
        stamps={stamps}
        totalCount={3}
        locale="ko"
      />,
    );

    expect(screen.getByRole("img", { name: "Elina Fan Passport, 브론즈, Stamp 3개" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-passport-stamp="knowledge"]')).toHaveLength(3);
  });

  it("shows only the latest nine without changing the authoritative total", () => {
    const stamps: PassportStampRecord[] = Array.from({ length: 10 }, (_, index) => ({
      id: `stamp-${index}`,
      type: index === 0 ? "knowledge" : "reservation",
      issuedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(),
    }));
    const { container } = render(
      <PassportStampCanvas
        celebrityName="Elina"
        level="실버"
        stamps={stamps}
        totalCount={10}
        locale="ko"
      />,
    );

    expect(screen.getByRole("img", { name: "Elina Fan Passport, 실버, 전체 10개 중 최근 9개 표시" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-passport-stamp]")).toHaveLength(9);
    expect(container.querySelector('[data-passport-stamp="knowledge"]')).toBeNull();
    expect(container.querySelectorAll('[data-passport-stamp="reservation"]')).toHaveLength(9);
  });
});
