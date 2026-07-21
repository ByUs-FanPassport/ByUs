import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IssuanceAggregate } from "../domain/issuance-aggregate";
import { PassportIssuanceDialog } from "./passport-issuance-dialog";

const aggregate: IssuanceAggregate = {
  passport: { id: "20000000-0000-4000-8000-000000000002", businessStatus: "issued", mintStatus: "processing", tokenId: null, issuedAt: "2026-07-21T05:00:00+00:00" },
  celebrity: { slug: "kara", name: "KARA", image: { url: "/kara.jpg", alt: "KARA", position: "center" } },
  firstStamp: { type: "knowledge", businessStatus: "issued", mintStatus: "retryable", tokenId: null, issuedAt: "2026-07-21T05:00:00+00:00" },
  score: { points: 1 },
};

describe("PassportIssuanceDialog", () => {
  it("can skip state motion and reaches the authoritative Passport detail route", () => {
    render(<PassportIssuanceDialog issuance={aggregate} />);
    expect(screen.getByRole("img", { name: "ByUs" })).toHaveAttribute("src", expect.stringContaining("byus-wordmark.svg"));
    expect(screen.getByRole("link", { name: "건너뛰기" })).toHaveAttribute("href", `/passports/${aggregate.passport.id}`);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getAllByText("팬 인증 스탬프 획득")).toHaveLength(2);
    expect(screen.getByText("발급 상태 확인 중")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Passport 열기" })).toHaveAttribute("href", `/passports/${aggregate.passport.id}`);
  });

  it("keeps a durable, text-labelled state when the approved stamp asset fails", () => {
    render(<PassportIssuanceDialog issuance={aggregate} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.error(screen.getByRole("img", { name: "KARA 팬 인증 스탬프" }));
    expect(screen.getByRole("status")).toHaveTextContent("팬 인증 스탬프 이미지를 불러오지 못했어요.");
    expect(screen.getByRole("link", { name: "Passport 열기" })).toBeInTheDocument();
  });
});
