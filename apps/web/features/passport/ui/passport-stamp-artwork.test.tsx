import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PassportStampCanvas,
  StampArtwork,
  VerificationSealArtwork,
  type PassportStampRecord,
} from "./passport-stamp-artwork";
import { STAMP_METADATA, stampTypeLabel } from "../domain/passport-read-model";

describe("Passport Stamp artwork", () => {
  it("keeps the Passport skeleton visible until both data and the base artwork are ready", async () => {
    const { container, rerender } = render(
      <PassportStampCanvas celebrityName="KARA" stamps={[]} locale="ko" loading />,
    );

    const canvas = container.querySelector("[data-passport-ready]");
    const image = container.querySelector("img");
    expect(canvas).toHaveAttribute("data-passport-ready", "false");
    expect(canvas).toHaveAttribute("aria-busy", "true");

    await act(async () => fireEvent.load(image!));
    expect(canvas).toHaveAttribute("data-passport-ready", "false");

    rerender(<PassportStampCanvas celebrityName="KARA" stamps={[]} locale="ko" />);
    expect(canvas).toHaveAttribute("data-passport-ready", "true");
    expect(canvas).toHaveAttribute("aria-busy", "false");
  });

  it("uses brand-neutral, text-labelled artwork rather than celebrity-specific image assets", () => {
    const { container } = render(
      <StampArtwork type="knowledge" locale="ko" />,
    );

    expect(screen.getByRole("img", { name: "팬 인증 Stamp" })).toBeInTheDocument();
    expect(screen.getByText("인증")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/kara|nualeaf/i);
  });

  it("keeps the reusable vintage frame transparent and free of baked product data", () => {
    const frame = readFileSync(
      join(process.cwd(), "public/images/stamps/vintage-seal-frame.svg"),
      "utf8",
    );

    expect(frame).toContain('viewBox="0 0 256 256"');
    expect(frame).not.toMatch(/kara|katseye|nualeaf|verified|2026|\+1/i);
    expect(frame).not.toMatch(/<rect[^>]+fill=["']#fff/i);
  });

  it("renders a localized, data-driven verification seal above the shared frame", () => {
    render(
      <VerificationSealArtwork
        celebrityName="KATSEYE"
        issuedAt="2026-07-26T08:00:00.000Z"
        points={1}
        locale="ko"
      />,
    );

    const seal = screen.getByRole("img", { name: /KATSEYE 팬 인증 Stamp.*1점 획득/ });
    expect(seal).toHaveTextContent("팬 인증");
    expect(seal).toHaveTextContent("VERIFIED");
    expect(seal).toHaveTextContent("2026.07.26");
    expect(seal).toHaveTextContent("+1");
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

    expect(screen.getByRole("img", { name: /^Elina Fan Passport, 브론즈, Stamp 3개,/ })).toBeInTheDocument();
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

    expect(screen.getByRole("img", { name: /^Elina Fan Passport, 실버, 전체 10개 중 최근 9개 표시,/ })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-passport-stamp]")).toHaveLength(9);
    expect(container.querySelector('[data-passport-stamp="knowledge"]')).toBeNull();
    expect(container.querySelectorAll('[data-passport-stamp="reservation"]')).toHaveLength(9);
  });
});
