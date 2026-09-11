import type { SolapiFulfillmentStatus, SolapiTemplateKey } from "./types.js";

export const SOLAPI_CHANNEL_ID = "KA01PF260907031546722DH51U2gFGrk";
export const SOLAPI_TEMPLATE_MANIFEST_VERSION = "solapi-templates-ko-v2";
export const SOLAPI_TEMPLATE_MANIFEST_STATUS = "approved_11_of_12_2026_09_11";

export interface SolapiPendingTemplate {
  templateKey: SolapiTemplateKey;
  fulfillmentStatus?: SolapiFulfillmentStatus;
  pendingRegisteredTemplateId: string;
  artifactName: string;
  variables: readonly string[];
}

// These IDs were registered for review on 2026-09-07. Presence here is not
// approval. Runtime authorization comes only from an explicit approval record.
export const SOLAPI_PENDING_TEMPLATES = [
  {templateKey:"live_reserved",pendingRegisteredTemplateId:"KA01TP260907033445072mn78mTsLaVg",artifactName:"byus_live_reserved_ko_v1",variables:["#{artist}","#{title}","#{startsAt}","#{liveSlug}"]},
  {templateKey:"live_24h",pendingRegisteredTemplateId:"KA01TP260907034017949sLbNPkQLGBs",artifactName:"byus_live_24h_ko_v1",variables:["#{artist}","#{title}","#{startsAt}","#{liveSlug}"]},
  {templateKey:"live_10m",pendingRegisteredTemplateId:"KA01TP260907034304115ByqnnAhlCoc",artifactName:"byus_live_10m_ko_v1",variables:["#{artist}","#{title}","#{startsAt}","#{liveSlug}"]},
  {templateKey:"live_changed",pendingRegisteredTemplateId:"KA01TP260907034426918n2VAUyqbqv0",artifactName:"byus_live_changed_ko_v1",variables:["#{artist}","#{title}","#{startsAt}","#{liveSlug}"]},
  {templateKey:"live_cancelled",pendingRegisteredTemplateId:"KA01TP260907034513012XiUpGjJ4bQU",artifactName:"byus_live_cancelled_ko_v1",variables:["#{artist}","#{title}","#{liveSlug}"]},
  {templateKey:"benefit_won",pendingRegisteredTemplateId:"KA01TP260907034548427ueVqEj03Jn9",artifactName:"byus_benefit_won_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"recipient_information_required",pendingRegisteredTemplateId:"KA01TP260907034624117IQ9ntqowc3u",artifactName:"byus_recipient_information_required_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"fulfillment_meaningful_update",fulfillmentStatus:"shipping_in_transit",pendingRegisteredTemplateId:"KA01TP260907034658771D6kucvQvlwr",artifactName:"byus_fulfillment_shipping_in_transit_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"fulfillment_meaningful_update",fulfillmentStatus:"shipping_completed",pendingRegisteredTemplateId:"KA01TP260907034727320h5IICVSvdTi",artifactName:"byus_fulfillment_shipping_completed_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"fulfillment_meaningful_update",fulfillmentStatus:"pickup_available",pendingRegisteredTemplateId:"KA01TP260907034757052KImeu1gLE8v",artifactName:"byus_fulfillment_pickup_available_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"fulfillment_meaningful_update",fulfillmentStatus:"pickup_completed",pendingRegisteredTemplateId:"KA01TP260907034829220P6ks9Ph30oV",artifactName:"byus_fulfillment_pickup_completed_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
  {templateKey:"fulfillment_meaningful_update",fulfillmentStatus:"digital_delivered",pendingRegisteredTemplateId:"KA01TP260907034853958V7dkrlHtD8o",artifactName:"byus_fulfillment_digital_delivered_ko_v1",variables:["#{artist}","#{title}","#{benefitId}"]},
] as const satisfies readonly SolapiPendingTemplate[];

// Verified against the SOLAPI channel on 2026-09-11. The rejected
// digital-delivered registration is intentionally absent and therefore remains
// fail closed in the request builder.
export const SOLAPI_APPROVED_TEMPLATES = [
  {templateKey:"live_reserved",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907033445072mn78mTsLaVg",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"live_24h",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034017949sLbNPkQLGBs",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"live_10m",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034304115ByqnnAhlCoc",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"live_changed",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034426918n2VAUyqbqv0",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"live_cancelled",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034513012XiUpGjJ4bQU",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"benefit_won",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034548427ueVqEj03Jn9",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"recipient_information_required",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034624117IQ9ntqowc3u",verifiedAt:"2026-09-11T00:00:00+09:00"},
  {templateKey:"fulfillment_meaningful_update",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034658771D6kucvQvlwr",verifiedAt:"2026-09-11T00:00:00+09:00",fulfillmentStatus:"shipping_in_transit"},
  {templateKey:"fulfillment_meaningful_update",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034727320h5IICVSvdTi",verifiedAt:"2026-09-11T00:00:00+09:00",fulfillmentStatus:"shipping_completed"},
  {templateKey:"fulfillment_meaningful_update",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034757052KImeu1gLE8v",verifiedAt:"2026-09-11T00:00:00+09:00",fulfillmentStatus:"pickup_available"},
  {templateKey:"fulfillment_meaningful_update",locale:"ko",channelId:SOLAPI_CHANNEL_ID,registeredTemplateId:"KA01TP260907034829220P6ks9Ph30oV",verifiedAt:"2026-09-11T00:00:00+09:00",fulfillmentStatus:"pickup_completed"},
] as const;

export const SOLAPI_HELD_TEMPLATE_KEYS = [
  "benefit_available",
  "benefit_unlocked",
  "survey_reminder",
  "collectible_claim_available",
  "collectible_claim_expiring",
  "level_up",
] as const;
