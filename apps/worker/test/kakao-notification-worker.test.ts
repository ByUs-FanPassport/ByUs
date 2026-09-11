import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KakaoNotificationJob, KakaoReconciliationJob } from "../src/kakao-notification-domain.js";
import type { KakaoNotificationQueue, KakaoSolapiClient } from "../src/kakao-notification-ports.js";
import { KakaoNotificationWorker } from "../src/kakao-notification-worker.js";
import { SOLAPI_CHANNEL_ID, SOLAPI_PENDING_TEMPLATES } from "../src/solapi/index.js";

const deliveryId = "018f47a2-8f4e-7c31-a1c2-12f6af3244a1";
const job: KakaoNotificationJob = {
  id:deliveryId,
  attemptToken:"028f47a2-8f4e-7c31-a1c2-12f6af3244a1",
  notificationId:"038f47a2-8f4e-7c31-a1c2-12f6af3244a1",
  templateKey:"live_reserved",
  locale:"ko",
  destination:"01012345678",
  payload:{
    title:"ignored presentation title",
    detail:"ignored presentation detail",
    deepLink:"/live/kara?locale=ko",
    context:{kind:"live",artist:"KARA",title:"Fan Meeting",startsAt:"2026-09-12T10:00:00+09:00"},
  },
  templateId:SOLAPI_PENDING_TEMPLATES[0].pendingRegisteredTemplateId,
  leaseExpiresAt:"2099-01-01T00:00:00Z",
};
const reconciliation: KakaoReconciliationJob = {
  id:deliveryId,
  providerMessageId:"M4Vsafe",
  groupId:"G4Vsafe",
  destinationFingerprint:"a".repeat(64),
  templateId:job.templateId,
  status:"accepted",
};

function dependencies() {
  const queue: KakaoNotificationQueue = {
    maintain:vi.fn(async () => undefined),
    claim:vi.fn(async () => [job]),
    begin:vi.fn(async () => true),
    recordSubmission:vi.fn(async () => undefined),
    claimReconciliations:vi.fn(async () => []),
    recordResult:vi.fn(async () => undefined),
  };
  const client: KakaoSolapiClient = {
    submitPrepared:vi.fn(async () => ({status:"accepted" as const,receipt:{providerMessageId:"M4Vsafe",groupId:"G4Vsafe"}})),
    lookup:vi.fn(async () => ({status:"pending" as const,statusCode:"2000"})),
  };
  return {queue,client,worker:new KakaoNotificationWorker(queue,client,{workerId:"worker:kakao",leaseSeconds:120})};
}

describe("KakaoNotificationWorker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maintains, reconciles, then validates and begins before one accepted submission", async () => {
    const {queue,client,worker} = dependencies();
    (queue.claimReconciliations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([reconciliation]);
    await expect(worker.runOnce()).resolves.toBe(2);
    expect(queue.maintain).toHaveBeenCalledBefore(queue.claimReconciliations as ReturnType<typeof vi.fn>);
    expect(queue.recordResult).toHaveBeenCalledBefore(queue.claim as ReturnType<typeof vi.fn>);
    expect(queue.claimReconciliations).toHaveBeenCalledWith(2);
    expect(queue.claim).toHaveBeenCalledWith("worker:kakao",2,120);
    expect(queue.begin).toHaveBeenCalledWith(job,job.templateId,expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(queue.begin).toHaveBeenCalledBefore(client.submitPrepared as ReturnType<typeof vi.fn>);
    expect(queue.recordSubmission).toHaveBeenCalledWith(job,{
      outcome:"accepted",providerMessageId:"M4Vsafe",groupId:"G4Vsafe",errorCode:null,
    });
    expect(queue.recordResult).toHaveBeenCalledWith(reconciliation,{status:"pending",statusCode:"2000"});
  });

  it("does not call HTTP when begin returns false for a duplicate attempt", async () => {
    const {queue,client,worker} = dependencies();
    (queue.begin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await worker.runOnce();
    expect(client.submitPrepared).not.toHaveBeenCalled();
    expect(queue.recordSubmission).not.toHaveBeenCalled();
  });

  it("does not call HTTP when a winning begin response is lost", async () => {
    const {queue,client,worker} = dependencies();
    (queue.begin as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("response lost after commit"));
    await expect(worker.runOnce()).rejects.toThrow("response lost");
    expect(client.submitPrepared).not.toHaveBeenCalled();
    expect(queue.recordSubmission).not.toHaveBeenCalled();
  });

  it("surfaces ACK storage failure without resending the provider request", async () => {
    const {queue,client,worker} = dependencies();
    (queue.recordSubmission as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ack unavailable"));
    await expect(worker.runOnce()).rejects.toThrow("ack unavailable");
    expect(client.submitPrepared).toHaveBeenCalledOnce();
    expect(queue.begin).toHaveBeenCalledOnce();
  });

  it("records a timeout as unknown and never retries or falls back", async () => {
    const {queue,client,worker} = dependencies();
    (client.submitPrepared as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status:"unknown",
      code:"SOLAPI_REQUEST_TIMEOUT",
      reconciliation:"DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION",
    });
    await worker.runOnce();
    expect(client.submitPrepared).toHaveBeenCalledOnce();
    expect(queue.recordSubmission).toHaveBeenCalledWith(job,{
      outcome:"unknown",providerMessageId:null,groupId:null,errorCode:"SOLAPI_REQUEST_TIMEOUT",
    });
  });

  it("suppresses malformed or mismatched claims before begin", async () => {
    for (const candidate of [
      {...job,locale:"en"},
      {...job,destination:"010-1234-5678"},
      {...job,templateId:"KA01TPwrong"},
      {...job,payload:{deepLink:"/live/kara?locale=ko",context:{artist:"KARA",title:"Fan Meeting"}}},
    ]) {
      const {queue,client,worker} = dependencies();
      (queue.claim as ReturnType<typeof vi.fn>).mockResolvedValueOnce([candidate]);
      await worker.runOnce();
      expect(queue.begin).not.toHaveBeenCalled();
      expect(client.submitPrepared).not.toHaveBeenCalled();
      expect(queue.recordSubmission).toHaveBeenCalledWith(candidate,expect.objectContaining({outcome:"suppressed"}));
    }
  });

  it.each([
    {status:"delivered" as const,statusCode:"4000" as const},
    {status:"failed" as const,statusCode:"3104"},
    {status:"unknown" as const,statusCode:null},
  ])("persists canonical reconciliation outcome $status", async (outcome) => {
    const {queue,client,worker} = dependencies();
    (queue.claim as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (queue.claimReconciliations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([reconciliation]);
    (client.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce(outcome);
    await worker.runOnce();
    expect(queue.recordResult).toHaveBeenCalledWith(reconciliation,outcome);
  });

  it("caps both provider phases at two jobs per tick", async () => {
    const {queue,worker} = dependencies();
    await worker.runOnce();
    expect(queue.claimReconciliations).toHaveBeenCalledWith(2);
    expect(queue.claim).toHaveBeenCalledWith("worker:kakao",2,120);
  });
});
