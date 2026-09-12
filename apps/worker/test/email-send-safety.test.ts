import { describe, expect, it, vi } from "vitest";
import { ExternalNotificationWorker } from "../src/external-notification-worker.js";
import type { ExternalNotificationJob } from "../src/external-notification-domain.js";

const job: ExternalNotificationJob = {
  id: "delivery", notificationId: "notification", planId: "plan", channel: "email",
  sequence: 1, templateKey: "live_10m", locale: "en", destination: "fan@example.invalid",
  payload: { title: "LIVE", detail: "Starting soon", deepLink: "/live/test" },
  attemptCount: 1, leaseOwner: "worker", leaseExpiresAt: "2099-01-01T00:00:00Z",
};

function setup() {
  let began = false;
  const queue = {
    claim: vi.fn(async () => [job]), revalidateEmail: vi.fn(async () => true),
    beginEmail: vi.fn(async () => { if (began) return false; began = true; return true; }),
    finishEmail: vi.fn(async () => {}),
    complete: vi.fn(async () => {}), fail: vi.fn(async () => {}), recordSink: vi.fn(async () => {}),
  };
  const send = vi.fn(async () => ({ providerMessageId: "ses-message" }));
  const worker = () => new ExternalNotificationWorker(queue, { email: { send }, kakao: { send } },
    { workerId: "worker", batchSize: 2, leaseSeconds: 120 });
  return { queue, send, worker };
}

describe("email single send boundary", () => {
  it("never calls the provider twice when two workers receive the same delivery", async () => {
    const { worker, send } = setup();
    await Promise.all([worker().runOnce(), worker().runOnce()]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not convert an accepted send with a failed DB acknowledgement into a retry", async () => {
    const { worker, queue, send } = setup();
    queue.finishEmail.mockRejectedValueOnce(new Error("DB acknowledgement lost"));
    await expect(worker().runOnce()).rejects.toThrow("DB acknowledgement lost");
    await worker().runOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("does not send if permission to begin is uncertain", async () => {
    const { worker, queue, send } = setup();
    queue.beginEmail.mockRejectedValueOnce(new Error("begin response lost"));
    await expect(worker().runOnce()).rejects.toThrow("begin response lost");
    expect(send).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("records an uncertain provider outcome without reopening the send", async () => {
    const { worker, queue, send } = setup();
    send.mockRejectedValueOnce(new Error("connection reset after acceptance"));
    await worker().runOnce();
    await worker().runOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(queue.finishEmail).toHaveBeenCalledWith(job, {
      outcome: "unknown", providerMessageId: null, errorCode: "EMAIL_SEND_OUTCOME_UNKNOWN",
    });
    expect(queue.fail).not.toHaveBeenCalled();
  });
});
