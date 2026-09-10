import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AppleLifecycleRepository, providerSubjectHash, sha256 } from "./apple-lifecycle";
import { receiveAppleNotification } from "./notification-route";
import { InvalidAppleNotificationError, AppleNotificationUnavailableError, type VerifiedAppleNotification } from "./verify-apple-notification";

const event: VerifiedAppleNotification = {
  eventId: "event-one", type: "email-disabled", subject: "apple-subject",
  audience: "kr.byus.web", issuedAt: 1789032000, eventTime: 1789032000,
  email: "owned@privaterelay.appleid.com", isPrivateEmail: true, payloadHash: "a".repeat(64),
};

function request(body: string, contentType = "application/json;charset=UTF-8") {
  return new Request("https://byus.kr/api/auth/apple/notifications", {
    method: "POST", headers: { "content-type": contentType }, body,
  });
}

function dependencies() {
  const rpc = vi.fn().mockResolvedValue({ data: { outcome: "applied", matched: true }, error: null });
  return { rpc, repository: new AppleLifecycleRepository({ rpc }), verify: vi.fn().mockResolvedValue(event) };
}

describe("Apple notification HTTP boundary", () => {
  it("persists only a verified normalized event with subject and destination hashes", async () => {
    const deps = dependencies();
    const response = await receiveAppleNotification(request(JSON.stringify({ payload: "signed-token" })), deps);
    expect(response.status).toBe(200);
    expect(deps.rpc).toHaveBeenCalledWith("apply_apple_account_notification", { p_event: {
      eventId: event.eventId, payloadHash: event.payloadHash, audience: event.audience, type: event.type,
      subjectHash: providerSubjectHash("apple", event.subject), eventTime: event.eventTime, issuedAt: event.issuedAt,
      emailFingerprint: sha256(event.email!),
    } });
    expect(JSON.stringify(deps.rpc.mock.calls)).not.toContain("owned@");
    expect(JSON.stringify(deps.rpc.mock.calls)).not.toContain("signed-token");
    expect(await response.json()).toEqual({ received: true });
  });

  it.each(["{", "{}", '{"payload":42}', JSON.stringify({ payload: "x".repeat(20_481) })])("rejects malformed or oversized input before signature verification", async (body) => {
    const deps = dependencies();
    expect((await receiveAppleNotification(request(body), deps)).status).toBe(400);
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-JSON input", async () => {
    const deps = dependencies();
    expect((await receiveAppleNotification(request("payload=jwt", "application/x-www-form-urlencoded"), deps)).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidAppleNotificationError(), 400],
    [new AppleNotificationUnavailableError(), 503],
  ])("never mutates state when signature verification fails", async (error, expectedStatus) => {
    const deps = dependencies();
    deps.verify.mockRejectedValue(error);
    expect((await receiveAppleNotification(request('{"payload":"jwt"}'), deps)).status).toBe(expectedStatus);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("acknowledges a durable duplicate and returns 503 on persistence failure", async () => {
    const deps = dependencies();
    deps.rpc.mockResolvedValueOnce({ data: { outcome: "duplicate", matched: true }, error: null });
    expect((await receiveAppleNotification(request('{"payload":"jwt"}'), deps)).status).toBe(200);
    deps.rpc.mockResolvedValueOnce({ data: null, error: { message: "private database detail" } });
    const response = await receiveAppleNotification(request('{"payload":"jwt"}'), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
