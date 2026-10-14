import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { communityStampKinds, type EntityType, type JobPayload } from "../src/domain.js";
import { KYAA_CREDENTIAL_ASSET_BASE_URI, kyaaCredentialImage } from "../src/kyaa-credential-assets.js";

const base = { recipient: `0x${"1".repeat(40)}`, celebritySlug: "new-creator-with-no-custom-art", issuanceId: `0x${"2".repeat(64)}` };
const cases: { entityType: EntityType; payload: JobPayload; key: string; actionCode?: number }[] = [
  { entityType: "passport", payload: { recipient: base.recipient, celebritySlug: base.celebritySlug, passportId: base.issuanceId }, key: "passport" },
  ...(["Knowledge", "Reservation", "Attendance", "Survey", "Membership"] as const).map((stampType) => ({ entityType: "stamp" as const, payload: { ...base, stampType }, key: stampType.toLowerCase() })),
  { entityType: "reaction", payload: { ...base, reactionType: "FirstReaction" }, key: "reaction" },
  { entityType: "stamp", payload: { ...base, stampType: "Survey" }, key: "mission", actionCode: 4 },
  ...communityStampKinds.map((stampKind) => ({ entityType: "community_stamp" as const, payload: { ...base, stampKind, celebritySlug: stampKind === "welcome" || stampKind === "invite" ? null : base.celebritySlug }, key: stampKind })),
];

describe("reviewed kyaa credential image bundle", () => {
  it.each(cases)("uses the published $key image for any creator", ({ entityType, payload, key, actionCode }) => {
    expect(kyaaCredentialImage(entityType, payload, KYAA_CREDENTIAL_ASSET_BASE_URI, actionCode)).toBe(`${KYAA_CREDENTIAL_ASSET_BASE_URI}/${key}.png`);
  });

  it("covers exactly the reviewed artwork files", () => {
    const manifest = JSON.parse(readFileSync(new URL("../assets/kyaa-credentials-v2/manifest.json", import.meta.url), "utf8")) as { assets: { key: string }[] };
    expect(cases.map((item) => item.key).sort()).toEqual(manifest.assets.map((item) => item.key).sort());
  });

  it("refuses an unverified bundle instead of constructing another missing URL", () => {
    expect(() => kyaaCredentialImage(cases[0]!.entityType, cases[0]!.payload, "ipfs://old-bundle")).toThrow(/unverified.*bundle/i);
  });

  it("refuses collectibles and unknown stamp types without a reviewed image", () => {
    expect(() => kyaaCredentialImage("collectible", { recipient: base.recipient, celebritySlug: base.celebritySlug, liveSlug: "live", claimId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c", metadataVersion: 1 }, KYAA_CREDENTIAL_ASSET_BASE_URI)).toThrow(/unsupported/i);
    expect(() => kyaaCredentialImage("stamp", { ...base, stampType: "Unknown" } as unknown as JobPayload, KYAA_CREDENTIAL_ASSET_BASE_URI)).toThrow(/unsupported/i);
  });
});
