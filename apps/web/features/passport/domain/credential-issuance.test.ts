import { describe, expect, it } from "vitest";

import {
  buildKnowledgeStampJob,
  buildPassportJob,
  mapQueueStatusToMintStatus,
} from "./credential-issuance";

const appUserId = "054dbe1b-a924-4957-bdbf-474906737a5e";
const passportRecordId = "3ff058e6-8865-46c5-ae01-94a93f1dbe3c";
const stampId = "82479946-5c2b-4cb7-838a-cd48f260bbcf";
const recipient = "0x82162619589cfE3e0DCC58C43DfBf121844f8e9C";

describe("credential issuance contract", () => {
  it("matches the deployed Dev Passport operation-key and keccak vector", () => {
    const job = buildPassportJob({ appUserId, passportRecordId, celebritySlug: "kara", recipient });

    expect(job.operationKey).toBe(
      "byus:passport:v1:054dbe1b-a924-4957-bdbf-474906737a5e:kara",
    );
    expect(job.payload.passportId).toBe(
      "0x9646a4e4d2c97e0824fbd1cfde719c3399035db1c3dcaf20fd2e472ce18e276c",
    );
    expect(job).toEqual({
      entityType: "passport",
      entityId: passportRecordId,
      operationKey: "byus:passport:v1:054dbe1b-a924-4957-bdbf-474906737a5e:kara",
      payloadVersion: 1,
      payload: {
        recipient,
        celebritySlug: "kara",
        passportId: "0x9646a4e4d2c97e0824fbd1cfde719c3399035db1c3dcaf20fd2e472ce18e276c",
      },
    });
  });

  it("builds the strict Knowledge Stamp worker v1 payload", () => {
    const job = buildKnowledgeStampJob({ stampId, celebritySlug: "kara", recipient });

    expect(job.operationKey).toBe(`byus:stamp:v1:${stampId}`);
    expect(job.payload.issuanceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(job).toEqual({
      entityType: "stamp",
      entityId: stampId,
      operationKey: `byus:stamp:v1:${stampId}`,
      payloadVersion: 1,
      payload: {
        recipient,
        celebritySlug: "kara",
        issuanceId: job.payload.issuanceId,
        stampType: "Knowledge",
      },
    });
  });

  it.each([
    ["PENDING", "queued"],
    ["PROCESSING", "processing"],
    ["COMPLETED", "minted"],
    ["RETRYING", "retryable"],
    ["FAILED", "permanent_failure"],
  ] as const)("maps queue %s to credential %s", (queueStatus, mintStatus) => {
    expect(mapQueueStatusToMintStatus(queueStatus)).toBe(mintStatus);
  });

  it("rejects non-canonical identifiers before a job can poison the worker queue", () => {
    expect(() =>
      buildPassportJob({ appUserId: "not-a-uuid", passportRecordId, celebritySlug: "kara", recipient }),
    ).toThrow();
    expect(() =>
      buildPassportJob({ appUserId, passportRecordId, celebritySlug: "KARA", recipient }),
    ).toThrow();
    expect(() =>
      buildKnowledgeStampJob({ stampId, celebritySlug: "kara", recipient: "0x1234" }),
    ).toThrow();
  });
});
