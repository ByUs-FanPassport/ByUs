import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPhoneSmsHandler, type PhoneSmsDependencies } from "./phone-sms-enrollment-route";
import { normalizeManualKoreanMobile, phoneCodeDigest, phoneRateKey, PhoneSmsError } from "./phone-sms-enrollment";
import { AuthError } from "../../features/auth/domain/auth-errors";
const id = "11111111-1111-4111-8111-111111111111"; const owner = "22222222-2222-4222-8222-222222222222";
function setup() {
  let created = false;
  const deps: PhoneSmsDependencies = { enabled: true, origin: "https://byus.kr", otpSecret: "x".repeat(32), authorize: vi.fn(async () => ({ appUserId: owner })),
    repository: { reserve: vi.fn(async () => { const first = !created; created = true; return { challengeId: id, destinationLabel: "010-****-5678", expiresAt: "2026-09-13T01:05:00Z", resendAt: "2026-09-13T01:01:00Z", status: "sending", created: first }; }),
      begin: vi.fn(async () => true), finish: vi.fn(async () => true), verify: vi.fn(async () => ({ verified: true })), confirm: vi.fn(), cancel: vi.fn(async () => true) },
    provider: { send: vi.fn(async () => ({ status: "accepted" as const, providerMessageId: "message-id", providerGroupId: "group-id" })) } };
  return deps;
}
const req = (body: unknown, origin = "https://byus.kr") => new Request("https://byus.kr/api/me/notification-channels/kakao/phone/request", { method: "POST", headers: { origin, "content-type": "application/json", authorization: "Bearer test" }, body: JSON.stringify(body) });
describe("manual phone verification routes", () => {
  it.each(["01012345678", "010-1234-5678", "+82 10-1234-5678"])("normalizes %s", (value) => expect(normalizeManualKoreanMobile(value)).toBe("01012345678"));
  it.each(["02012345678", "+12025550123", "010123456789", "0101234<script>"])("rejects %s", (value) => expect(() => normalizeManualKoreanMobile(value)).toThrow());
  it("binds code digest to owner and challenge, and hides enumerable phone in keyed rate identifier", () => {
    const digest = phoneCodeDigest("secret", owner, id, "123456");
    expect(digest).not.toBe(phoneCodeDigest("secret", id, owner, "123456"));
    expect(digest).not.toBe(phoneCodeDigest("other", owner, id, "123456"));
    expect(phoneRateKey("secret", "01012345678")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("reserves and begins before sending, returning no OTP/raw phone/provider IDs", async () => {
    const deps = setup(); const handler = createPhoneSmsHandler("request", deps);
    const response = await handler(req({ phone: "01012345678", requestId: id }));
    expect(response.status).toBe(200);
    const text = await response.text(); expect(text).not.toMatch(/01012345678|otp|digest|providerMessage/);
    const reserveOrder = vi.mocked(deps.repository.reserve).mock.invocationCallOrder[0];
    expect(reserveOrder).toBeLessThan(vi.mocked(deps.repository.begin).mock.invocationCallOrder[0]);
    expect(vi.mocked(deps.repository.begin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.provider.send).mock.invocationCallOrder[0]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("never sends again on idempotent request or failed provider ACK persistence", async () => {
    const deps = setup(); vi.mocked(deps.repository.finish).mockRejectedValue(new Error("db unavailable"));
    const handler = createPhoneSmsHandler("request", deps);
    const first = await handler(req({ phone: "01012345678", requestId: id }));
    expect((await first.json()).challenge.status).toBe("unknown");
    await handler(req({ phone: "01012345678", requestId: id }));
    expect(deps.provider.send).toHaveBeenCalledTimes(1);
    expect(deps.repository.begin).toHaveBeenCalledTimes(1);
  });
  it("cannot send after losing begin CAS", async () => {
    const deps = setup(); vi.mocked(deps.repository.begin).mockResolvedValue(false);
    await createPhoneSmsHandler("request", deps)(req({ phone: "01012345678", requestId: id }));
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  it("uses authenticated owner and never takes an owner or digest from the browser", async () => {
    const deps = setup();
    expect((await createPhoneSmsHandler("verify", deps)(req({ challengeId: id, code: "123456", owner }))).status).toBe(400);
    expect(deps.repository.verify).not.toHaveBeenCalled();
    expect((await createPhoneSmsHandler("verify", deps)(req({ challengeId: id, code: "123456" }))).status).toBe(200);
    expect(deps.repository.verify).toHaveBeenCalledWith(owner, id, phoneCodeDigest(deps.otpSecret, owner, id, "123456"));
    expect(deps.repository.confirm).not.toHaveBeenCalled();
  });
  it("requires explicit fixed-version consent after verification", async () => {
    const deps = setup();
    const handler = createPhoneSmsHandler("confirm", deps);
    expect((await handler(req({ challengeId: id, consented: false, consentVersion: "kakao-alimtalk-v1" }))).status).toBe(400);
    expect(deps.repository.confirm).not.toHaveBeenCalled();
  });
  it("returns committed wrong-code result without attempting enrollment", async () => {
    const deps = setup(); vi.mocked(deps.repository.verify).mockResolvedValue({ verified: false, error: "PHONE_SMS_ATTEMPTS_EXHAUSTED" });
    const response = await createPhoneSmsHandler("verify", deps)(req({ challengeId: id, code: "123456" }));
    expect((await response.json()).error.code).toBe("PHONE_SMS_ATTEMPTS_EXHAUSTED");
    expect(deps.repository.confirm).not.toHaveBeenCalled();
  });
  it("rejects disabled, cross-origin, oversized and unauthenticated requests without a send", async () => {
    const deps = setup(); const handler = createPhoneSmsHandler("request", deps);
    deps.enabled = false; expect((await handler(req({}))).status).toBe(503); deps.enabled = true;
    expect((await handler(req({}, "https://attacker.test"))).status).toBe(400);
    expect((await handler(req({ phone: "0".repeat(2000), requestId: id }))).status).toBe(400);
    vi.mocked(deps.authorize).mockRejectedValue(new AuthError("AUTHENTICATION_REQUIRED", 401, "Required"));
    expect((await handler(req({ phone: "01012345678", requestId: id }))).status).toBe(401);
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
  it("reports rate limiting without exposing internal error text", async () => {
    const deps = setup(); vi.mocked(deps.repository.reserve).mockRejectedValue(new PhoneSmsError("PHONE_SMS_RATE_LIMITED"));
    expect((await createPhoneSmsHandler("request", deps)(req({ phone: "01012345678", requestId: id }))).status).toBe(429);
    expect(deps.provider.send).not.toHaveBeenCalled();
  });
});
