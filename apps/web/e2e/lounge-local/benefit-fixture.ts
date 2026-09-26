import type { BenefitCatalogItem } from "../../features/benefit/domain/benefit";

export const benefitFixture = {
  id: "41ae7883-098e-49f2-9229-4f6962160141", slug: "ifew-banksy-tickets-20260912",
  title: "뱅크시 전시 티켓", summary: "팬 활동으로 모은 응모권을 사용해 전시 티켓에 응모하세요.",
  imageUrl: "/images/raffles/banksy-statue-20260911.jpg",
  eligibilityLabel: "이퓨 응모권으로 응모하세요.", deliveryLabel: "당첨자 5명에게 2장씩 지급합니다.",
  deliveryType: "unique_code", allocationMode: "application_selection", applicationStatus: null,
  claimOpensAt: "2020-01-01T00:00:00.000Z", claimClosesAt: "2099-01-01T00:00:00.000Z",
  minimumScore: 0, minimumLevel: "Bronze", requiredStampType: null, requiredActivityType: null, state: "eligible",
  entry: {
    campaignId: "55555555-5555-4555-8555-555555555555", creatorTicketBalance: 5, enteredTickets: 0,
    perFanTicketLimit: null, remainingBenefitTickets: null, entryOpensAt: "2020-01-01T00:00:00.000Z",
    entryClosesAt: "2099-01-01T00:00:00.000Z", canEnter: true, entries: [],
  },
} satisfies BenefitCatalogItem;

export const benefitResultFixture = {
  benefitId: benefitFixture.id, campaignId: benefitFixture.entry.campaignId, title: benefitFixture.title,
  benefitHref: `/benefits/${benefitFixture.id}`, state: "not_entered", enteredTickets: 0,
  entryClosesAt: benefitFixture.entry.entryClosesAt, publishedAt: null, winnerId: null,
  method: "on_site_pickup", fulfillmentStatus: null, claimDisposition: "active",
  recipientDeadlineAt: null, recipientSubmitted: false, recipientEditable: false, policy: null,
};

export const recipientWinnerId = "11111111-1111-4111-8111-111111111111";

export const recipientRewardsFixture = [{
  rewardResultId: "33333333-3333-4333-8333-333333333333",
  winnerId: recipientWinnerId,
  benefitId: benefitFixture.id,
  title: "뱅크시 전시 티켓",
  campaignId: benefitFixture.entry.campaignId,
  result: "won",
  method: "physical_shipping",
  status: "information_required",
  enteredTickets: 3,
  recipientRequired: true,
  updatedAt: "2026-09-27T00:00:00.000Z",
  benefitHref: `/benefits/${benefitFixture.id}`,
}] as const;

export const recipientDetailsFixture = {
  winnerId: recipientWinnerId,
  revision: 1,
  editable: true,
  deadlineAt: "2099-09-30T15:00:00.000Z",
  claimDisposition: "active",
  policy: {
    version: "v1",
    method: "physical_shipping",
    shippingCountry: "KR",
    requiresShippingAcknowledgment: true,
    recipientWindowDays: 7,
    pickupEndsOn: null,
    pickupVenue: { ko: "", en: "" },
    pickupInstructions: { ko: "", en: "" },
  },
  recipient: null,
} as const;

export const sharedPassportToken = "dddddddddddddddddddddddddddddddd";
export const sharedPassportActivityFixture = {
  creator: "elina",
  issuedAt: "2026-07-26T00:00:00.000Z",
  tier: "Bronze",
  score: 7,
  activityCount: 12,
  stampCount: 6,
} as const;
