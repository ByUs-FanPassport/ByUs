import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AppleLifecycleRepository, providerSubjectHash, sha256 } from "./apple-lifecycle";
import { receiveAppleNotification } from "./notification-route";
import { InvalidAppleNotificationError, AppleNotificationUnavailableError, type VerifiedAppleNotification } from "./verify-apple-notification";

const event: VerifiedAppleNotification = {
  eventId: "event-one", type: "email-disabled", subject: "apple-subject",
  audience: "kr.byus.web", issuedAt: 1789032000, eventTime: 1789032000123,
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
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

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
    expect(warn).toHaveBeenLastCalledWith("apple_notification_rejected", { reason: "INVALID_ENVELOPE" });
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

  it("logs only the fixed rejection structure and sanitized verifier diagnostic", async () => {
    const deps = dependencies();
    const rejection = new InvalidAppleNotificationError("JWT_CLAIM_INVALID", {
      claim: "aud",
      issuer: "https://appleid.apple.com",
      audience: ["wrong.client"],
      leaked: "arbitrary diagnostic secret",
    } as unknown as { claim: "aud"; issuer: string; audience: string[] });
    rejection.stack = "arbitrary error secret";
    Object.defineProperty(rejection, "cause", { value: new Error("arbitrary error secret") });
    deps.verify.mockRejectedValue(rejection);

    const token = "secret-token";
    const response = await receiveAppleNotification(request(JSON.stringify({ payload: token })), deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_APPLE_NOTIFICATION" } });
    expect(warn).toHaveBeenCalledWith("apple_notification_rejected", {
      reason: "JWT_CLAIM_INVALID",
      diagnostic: {
        claim: "aud",
        issuer: "https://appleid.apple.com",
        audience: ["wrong.client"],
      },
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(event.subject);
    expect(logged).not.toContain(event.email!);
    expect(logged).not.toContain("arbitrary error secret");
    expect(logged).not.toContain("arbitrary diagnostic secret");
  });

  it("does not copy arbitrary transient verification errors into logs", async () => {
    const deps = dependencies();
    deps.verify.mockRejectedValue(new Error("arbitrary error secret"));

    const response = await receiveAppleNotification(request('{"payload":"secret-token"}'), deps);

    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledWith("apple_notification_rejected", {
      reason: "VERIFICATION_UNAVAILABLE",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-token|arbitrary error secret/u);
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
