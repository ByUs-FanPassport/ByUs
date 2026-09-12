import type { BlockchainJob, CommunityStampPayloadV1, JobPayload } from "./domain.js";
import type { MetadataDocument } from "./ports.js";
import { MEMBERSHIP_STAMP_IMAGE_URI } from "./membership-stamp-asset.js";

// ERC metadata requires a top-level `name`; only person-identifying name fields
// are forbidden. Values are additionally produced from closed enums/slugs.
type StampPayload = Extract<JobPayload, { stampType: string }>;

const forbiddenKeys = new Set(["email", "nickname", "realName", "personalName", "phone", "wallet", "recipient", "entityId", "issuanceId", "invitationCode", "occurredAt"]);

const communityStampMetadata = {
  welcome: { credential: "Welcome Stamp", asset: "welcome" },
  first_comment: { credential: "First Comment Stamp", asset: "first-comment" },
  subscription: { credential: "Subscription Stamp", asset: "subscription" },
  support: { credential: "Support Stamp", asset: "support" },
  share: { credential: "Share Stamp", asset: "share" },
  invite: { credential: "Invite Stamp", asset: "invite" },
  daily_checkin: { credential: "Daily Check-in Stamp", asset: "daily-checkin" },
} as const;

export function renderMetadata(job: BlockchainJob, payload: JobPayload, assetBaseUri: string): MetadataDocument {
  const community = job.entityType === "community_stamp"
    ? communityStampMetadata[(payload as CommunityStampPayloadV1).stampKind]
    : null;
  const credential = community?.credential ?? (job.entityType === "passport"
    ? "Fan Passport"
    : job.entityType === "reaction"
      ? "First Reaction"
      : job.entityType === "collectible"
        ? "Digital Collectible"
      : (payload as Extract<JobPayload, { stampType: string }>).stampType === "Knowledge"
        ? "Fan Verification Stamp"
        : `${(payload as Extract<JobPayload, { stampType: string }>).stampType} Stamp`);
  const assetPath = job.entityType === "community_stamp"
    ? null
    : job.entityType === "passport"
    ? `passport/${payload.celebritySlug}.png`
    : job.entityType === "reaction"
      ? `reaction/first/${payload.celebritySlug}.png`
      : job.entityType === "collectible"
        ? `collectible/${payload.celebritySlug}/${(payload as Extract<JobPayload, { liveSlug: string }>).liveSlug}.png`
      : `stamp/${(payload as Extract<JobPayload, { stampType: string }>).stampType.toLowerCase()}/${payload.celebritySlug}.png`;
  const attributes: Array<{ trait_type: string; value: string }> = [
    { trait_type: "Credential", value: credential },
  ];
  if (payload.celebritySlug !== null) attributes.push({ trait_type: "Celebrity", value: payload.celebritySlug });
  attributes.push(
    { trait_type: "Transferability", value: "Soulbound" },
    { trait_type: "Metadata Version", value: "1" },
  );
  const document: MetadataDocument = {
    schema: "https://byus.kr/schemas/credential-metadata-v1.json",
    version: 1,
    name: `ByUs ${credential}`,
    description: `A soulbound ByUs ${credential} credential.`,
    image: community
      ? `https://byus.kr/images/community-stamps/${community.asset}.png`
      : job.entityType === "stamp" && (payload as StampPayload).stampType === "Membership"
      ? MEMBERSHIP_STAMP_IMAGE_URI
      : `${assetBaseUri.replace(/\/$/, "")}/${assetPath}`,
    attributes,
  };
  assertPiiFree(document);
  return document;
}

export function assertPiiFree(value: unknown): void {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (forbiddenKeys.has(key)) throw new Error(`PII field is forbidden in metadata: ${key}`);
        visit(child);
      }
    }
  };
  visit(value);
}
