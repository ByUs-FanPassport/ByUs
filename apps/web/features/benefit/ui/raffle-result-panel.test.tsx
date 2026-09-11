import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ownedRaffleResultSchema, type OwnedRaffleResult } from "../domain/raffle-result";
import { RaffleResultPanel } from "./raffle-result-panel";

const base = {
  benefitId: "11111111-1111-4111-8111-111111111111",
  campaignId: "22222222-2222-4222-8222-222222222222",
  title: "긴 이름도 안전하게 표시되는 한정판 경품",
  benefitHref: "/benefits/11111111-1111-4111-8111-111111111111",
  state: "pending",
  enteredTickets: 4,
  entryClosesAt: "2026-09-20T00:00:00+09:00",
  publishedAt: null,
  winnerId: null,
  method: "on_site_pickup",
  fulfillmentStatus: null,
  claimDisposition: "active",
  recipientDeadlineAt: null,
  recipientSubmitted: false,
  recipientEditable: false,
  policy: null,
} satisfies OwnedRaffleResult;

function result(overrides: Partial<OwnedRaffleResult> = {}) {
  return ownedRaffleResultSchema.parse({ ...base, ...overrides });
}

describe("RaffleResultPanel", () => {
  it.each([
    ["not_entered", "응모 내역이 없어요"],
    ["pending", "결과 발표를 기다리고 있어요"],
    ["not_won", "이번에는 당첨되지 않았어요"],
    ["cancelled", "래플이 취소됐어요"],
  ] as const)("maps %s without inventing a winning state", (state, label) => {
    render(<RaffleResultPanel result={result({
      state,
      enteredTickets: state === "not_entered" ? 0 : 4,
      publishedAt: state === "not_won" ? "2026-09-21T00:00:00+09:00" : null,
    })} locale="ko" />);
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.queryByText("당첨됐어요")).not.toBeInTheDocument();
  });

  it("labels ready as submitted information, not pickup availability", () => {
    render(<RaffleResultPanel result={result({
      state: "won",
      publishedAt: "2026-09-21T00:00:00+09:00",
      winnerId: "33333333-3333-4333-8333-333333333333",
      fulfillmentStatus: "ready",
      recipientSubmitted: true,
      recipientEditable: true,
      recipientDeadlineAt: "2099-09-28T00:00:00+09:00",
    })} locale="ko" />);
    expect(screen.getByRole("heading", { name: "수령 정보가 접수됐어요" })).toBeInTheDocument();
    expect(screen.queryByText("현장 수령이 가능해요")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수령 정보 확인하기" })).toHaveAttribute(
      "href",
      "/my/rewards/33333333-3333-4333-8333-333333333333/recipient?locale=ko",
    );
  });

  it("shows pickup details only when pickup_available", () => {
    render(<RaffleResultPanel result={result({
      state: "won",
      publishedAt: "2026-09-21T00:00:00+09:00",
      winnerId: "33333333-3333-4333-8333-333333333333",
      fulfillmentStatus: "pickup_available",
      recipientSubmitted: true,
      recipientEditable: false,
      recipientDeadlineAt: "2099-09-28T00:00:00+09:00",
      policy: {
        version: "onsite-v1",
        method: "on_site_pickup",
        shippingCountry: null,
        requiresShippingAcknowledgment: false,
        recipientWindowDays: 7,
        pickupEndsOn: "2026-11-03",
        pickupVenue: { ko: "전시장 입장 데스크", en: "Exhibition entrance desk" },
        pickupInstructions: { ko: "성명과 휴대폰 뒤 4자리로 확인해 주세요.", en: "Confirm with your name and last four phone digits." },
      },
    })} locale="ko" />);
    expect(screen.getByRole("heading", { name: "현장 수령이 가능해요" })).toBeInTheDocument();
    expect(screen.getByText("전시장 입장 데스크")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수령 방법 확인하기" })).toBeInTheDocument();
  });

  it.each([
    ["unclaimed", "수령이 종료됐어요"],
    ["overdue", "수령 정보 제출 기한이 지났어요"],
  ] as const)("keeps the win but removes recipient CTA for %s", (kind, label) => {
    render(<RaffleResultPanel result={result({
      state: "won",
      publishedAt: "2026-09-21T00:00:00+09:00",
      winnerId: "33333333-3333-4333-8333-333333333333",
      fulfillmentStatus: "information_required",
      claimDisposition: kind === "unclaimed" ? "unclaimed" : "active",
      recipientDeadlineAt: "2020-09-28T00:00:00+09:00",
    })} locale="ko" />);
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "수령 정보 입력하기" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ByUs에 문의하기" })).toBeInTheDocument();
  });
});

it("shows only the winner's shipping carrier and tracking number", () => {
  render(<RaffleResultPanel locale="ko" result={result({state:"won",method:"physical_shipping",publishedAt:"2026-09-21T00:00:00+09:00",winnerId:"33333333-3333-4333-8333-333333333333",fulfillmentStatus:"shipping_in_transit",recipientSubmitted:true,carrier:"CJ대한통운",trackingNumber:"123456789012"})} />);
  expect(screen.getByText("CJ대한통운")).toBeInTheDocument(); expect(screen.getByText("123456789012")).toBeInTheDocument();
});

it("keeps the embedded empty result concise without repeating the product or closing date", () => {
  render(<RaffleResultPanel embedded locale="ko" result={result({ state: "not_entered", enteredTickets: 0 })} />);
  expect(screen.getByRole("status")).toHaveTextContent("응모 내역이 없어요");
  expect(screen.queryByText(base.title)).not.toBeInTheDocument();
  expect(screen.queryByText("응모 마감")).not.toBeInTheDocument();
});

it("preserves winner deadlines and recipient actions in the embedded result", () => {
  render(<RaffleResultPanel embedded locale="en" result={result({
    state: "won", publishedAt: "2026-09-21T00:00:00+09:00",
    winnerId: "33333333-3333-4333-8333-333333333333",
    fulfillmentStatus: "information_required", recipientDeadlineAt: "2099-09-28T00:00:00+09:00",
  })} />);
  expect(screen.getByText("Recipient details due")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Enter recipient details" })).toHaveAttribute("href", "/my/rewards/33333333-3333-4333-8333-333333333333/recipient?locale=en");
  expect(screen.queryByText(base.title)).not.toBeInTheDocument();
});
