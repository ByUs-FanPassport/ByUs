import { describe, expect, it } from "vitest";
import {
  communityStampKinds,
  parseJobPayload,
  type BlockchainJob,
  type CommunityStampPayloadV1,
} from "../src/domain.js";
import { renderMetadata } from "../src/metadata.js";

const recipient = `0x${"1".repeat(40)}`;
const issuanceId = `0x${"2".repeat(64)}`;

function job(payload: unknown): BlockchainJob {
  return {
    id: "82479946-5c2b-4cb7-838a-cd48f260bbcf",
    entityType: "community_stamp",
    entityId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c",
    operationKey: "community-stamp:test",
    payloadVersion: 1,
    payload,
    attempts: 1,
    maxAttempts: 8,
    txHash: null,
    leaseOwner: "worker-test",
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
  };
}

const names = {
  welcome: "ByUs Welcome Stamp",
  first_comment: "ByUs First Comment Stamp",
  subscription: "ByUs Subscription Stamp",
  support: "ByUs Support Stamp",
  share: "ByUs Share Stamp",
  invite: "ByUs Invite Stamp",
  daily_checkin: "ByUs Daily Check-in Stamp",
} as const;

const assets = {
  welcome: "welcome",
  first_comment: "first-comment",
  subscription: "subscription",
  support: "support",
  share: "share",
  invite: "invite",
  daily_checkin: "daily-checkin",
} as const;

describe("community stamp payload v1", () => {
  it.each(communityStampKinds)("accepts the closed %s kind with its required scope", (stampKind) => {
    const celebritySlug = stampKind === "welcome" || stampKind === "invite" ? null : "kara";
    expect(parseJobPayload(job({ recipient, issuanceId, stampKind, celebritySlug }))).toEqual({
      recipient,
      issuanceId,
      stampKind,
      celebritySlug,
    });
  });

  it.each([
    ["welcome", "kara"],
    ["invite", "kara"],
    ["first_comment", null],
    ["subscription", null],
    ["support", null],
    ["share", null],
    ["daily_checkin", null],
  ] as const)("rejects %s with the wrong celebrity scope", (stampKind, celebritySlug) => {
    expect(() => parseJobPayload(job({ recipient, issuanceId, stampKind, celebritySlug }))).toThrow();
  });

  it("rejects unknown kinds, additional source data, and other payload versions", () => {
    expect(() => parseJobPayload(job({ recipient, issuanceId, stampKind: "attendance", celebritySlug: "kara" }))).toThrow();
    expect(() => parseJobPayload(job({ recipient, issuanceId, stampKind: "share", celebritySlug: "kara", sourceId: "private" }))).toThrow();
    expect(() => parseJobPayload({ ...job({ recipient, issuanceId, stampKind: "share", celebritySlug: "kara" }), payloadVersion: 2 })).toThrow("Unsupported payload version");
  });
});

describe("community stamp metadata", () => {
  it.each(communityStampKinds)("publishes canonical %s artwork without operational identifiers", (stampKind) => {
    const payload: CommunityStampPayloadV1 = {
      recipient,
      issuanceId,
      stampKind,
      celebritySlug: stampKind === "welcome" || stampKind === "invite" ? null : "kara",
    };
    const document = renderMetadata(job(payload), payload, "ipfs://unused");

    expect(document.name).toBe(names[stampKind]);
    expect(document.image).toBe(`https://byus.kr/images/community-stamps/${assets[stampKind]}.png`);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain(recipient);
    expect(serialized).not.toContain(issuanceId);
    expect(serialized).not.toContain(job(payload).entityId);
    expect(serialized).not.toContain(job(payload).operationKey);
  });

  it.each(["welcome", "invite"] as const)("omits Celebrity from the global %s stamp", (stampKind) => {
    const payload: CommunityStampPayloadV1 = { recipient, issuanceId, stampKind, celebritySlug: null };
    expect(renderMetadata(job(payload), payload, "ipfs://unused").attributes)
      .not.toContainEqual(expect.objectContaining({ trait_type: "Celebrity" }));
  });
});
