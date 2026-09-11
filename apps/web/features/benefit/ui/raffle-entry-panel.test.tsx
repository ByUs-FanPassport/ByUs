import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BenefitCatalogItem } from "../domain/benefit";
import type { RaffleList } from "../domain/raffle";

const submit = vi.fn();
const retry = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { id: "owner-a" }, getAccessToken: vi.fn() }),
}));

vi.mock("./use-raffle-entry", () => ({
  useRaffleEntry: () => {
    const [unresolvedRequest, setUnresolvedRequest] = useState<null | { idempotencyKey: string; ticketAmount: number }>(null);
    return {
      pending: false,
      unresolvedRequest,
      receipt: null,
      error: unresolvedRequest ? "uncertain" : null,
      reconciling: false,
      reconciled: false,
      submit: async (input: { ticketAmount: number }) => {
        submit(input);
        setUnresolvedRequest({ idempotencyKey: "same-request", ticketAmount: input.ticketAmount });
      },
      retry: async () => { retry(); },
      retryReconciliation: vi.fn(),
      clearReceipt: vi.fn(),
    };
  },
}));

import { RaffleEntryPanel, raffleEntryErrorText } from "./raffle-entry-panel";

const policy = {
  version: "digital-v1",
  method: "digital" as const,
  shippingCountry: null,
  requiresShippingAcknowledgment: false,
  recipientWindowDays: 7 as const,
  pickupEndsOn: null,
  pickupVenue: { ko: "", en: "" },
  pickupInstructions: { ko: "", en: "" },
};

const raffle: RaffleList["raffles"][number] = {
  id: "11111111-1111-4111-8111-111111111111",
  benefitId: "11111111-1111-4111-8111-111111111111",
  title: "선물",
  summary: "선물 설명",
  imageUrl: null,
  winnerQuantity: 1,
  status: "open",
  entryOpensAt: "2026-01-01T00:00:00.000Z",
  entryClosesAt: "2030-01-01T00:00:00.000Z",
  fulfillmentMethod: "digital",
  fulfillmentPolicy: policy,
  perFanTicketLimit: 3,
};

const benefit: BenefitCatalogItem = {
  id: raffle.benefitId!, slug: "gift", title: "선물", summary: "선물 설명",
  eligibilityLabel: "Silver 이상", deliveryLabel: "디지털 지급", deliveryType: "unique_code",
  allocationMode: "direct_claim", applicationStatus: null,
  claimOpensAt: "2026-01-01T00:00:00.000Z", claimClosesAt: "2030-01-01T00:00:00.000Z",
  minimumScore: 0, minimumLevel: "Silver", requiredStampType: null, requiredActivityType: null,
  state: "eligible",
  entry: {
    fulfillmentPolicy: policy, campaignId: "22222222-2222-4222-8222-222222222222",
    creatorTicketBalance: 4, enteredTickets: 1, perFanTicketLimit: 3, remainingBenefitTickets: 3,
    entryOpensAt: "2026-01-01T00:00:00.000Z", entryClosesAt: "2030-01-01T00:00:00.000Z",
    canEnter: true, entries: [],
  },
};

const celebrity = {
  slug: "creator", locale: "ko" as const, name: "Creator", summary: "Creator summary",
  image: { url: "/creator.jpg", alt: "Creator portrait", position: "center" as const },
  roles: ["creator"] as const, themes: [], socialLinks: [], displayOrder: 0, fanCount: 10,
};

describe("raffle entry error copy", () => {
  it("describes a pre-submit durable-storage failure without claiming an uncertain server result", () => {
    expect(raffleEntryErrorText("storage", "ko")).toContain("안전하게 저장하지 못했어요");
    expect(raffleEntryErrorText("storage", "ko")).not.toContain("접수 결과");
    expect(raffleEntryErrorText("storage", "en")).toContain("safely save this entry request");
  });

  it.each([
    ["ko", "1장으로 응모하기", "응모 확정", "같은 응모 요청 확인", "닫기"],
    ["en", "Enter with 1 tickets", "Confirm entry", "Check the same entry", "Close"],
  ] as const)("retries the unresolved request from the open %s confirmation dialog without submitting a new one", async (locale, openLabel, confirmLabel, retryLabel, closeLabel) => {
    submit.mockClear();
    retry.mockClear();
    render(<RaffleEntryPanel
      celebrity={celebrity}
      locale={locale}
      raffle={raffle}
      benefit={benefit}
      loading={false}
      loadFailed={false}
      status="open"
      refresh={vi.fn()}
      onAccepted={vi.fn()}
      onReconciled={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: openLabel }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));

    const sameRequest = await within(dialog).findByRole("button", { name: retryLabel });
    expect(sameRequest).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: closeLabel })).toBeEnabled();
    fireEvent.click(sameRequest);

    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledOnce();
  });
});
