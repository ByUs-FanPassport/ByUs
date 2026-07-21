import { describe, expect, it } from "vitest";
import { assertPiiFree, renderMetadata } from "../src/metadata.js";
import type { BlockchainJob, PassportPayloadV1, StampPayloadV1 } from "../src/domain.js";

const payload: PassportPayloadV1 = {
  recipient: `0x${"1".repeat(40)}`,
  celebritySlug: "kara",
  passportId: `0x${"2".repeat(64)}`,
};
const job: BlockchainJob = {
  id: "82479946-5c2b-4cb7-838a-cd48f260bbcf", entityType: "passport",
  entityId: "3ff058e6-8865-46c5-ae01-94a93f1dbe3c", operationKey: "passport:test",
  payloadVersion: 1, payload, attempts: 1, maxAttempts: 8, txHash: null,
  leaseOwner: "worker-test", leaseExpiresAt: "2099-01-01T00:00:00.000Z",
};

describe("credential metadata", () => {
  it("is versioned, deterministic and omits private job and wallet identifiers", () => {
    const first = renderMetadata(job, payload, "ipfs://bafy-assets/v1/");
    const second = renderMetadata(job, payload, "ipfs://bafy-assets/v1/");
    expect(first).toEqual(second);
    expect(first.version).toBe(1);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(payload.recipient);
    expect(serialized).not.toContain(job.entityId);
    expect(serialized).not.toContain(job.operationKey);
  });

  it.each(["email", "realName", "nickname", "phone", "recipient"])("blocks the PII-shaped key %s", (key) => {
    expect(() => assertPiiFree({ [key]: "secret" })).toThrow("PII field is forbidden");
  });

  it.each(["Knowledge", "Reservation", "Attendance", "Survey"] as const)("uses a distinct immutable asset path for the %s Stamp", (stampType) => {
    const stampPayload: StampPayloadV1 = {
      recipient: payload.recipient,
      celebritySlug: "kara",
      issuanceId: payload.passportId,
      stampType,
    };
    const stampJob = { ...job, entityType: "stamp" as const, payload: stampPayload };
    expect(renderMetadata(stampJob, stampPayload, "ipfs://bafy-assets/credentials/v1").image)
      .toBe(`ipfs://bafy-assets/credentials/v1/stamp/${stampType.toLowerCase()}/kara.png`);
  });
});
