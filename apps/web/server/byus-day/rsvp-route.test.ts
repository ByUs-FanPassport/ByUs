import { createDecipheriv } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createRsvpHandler, RsvpError } from "./rsvp-route";
import { parseRsvpEncryptionKey, rsvpEncryptionAad } from "./rsvp-crypto";

const input = { idempotencyKey: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", locale: "ko", koreanName: "김별", englishName: "Byeol Kim", phone: "010-1234-5678", affiliation: "ByUs", occupation: "기획", email: "BYEOL@example.com", nationality: "kr", residentRegistrationNumber: "900101-1234567", consent: true };
function request(body: unknown = input, headers: Record<string, string> = {}, url = "https://byus.kr/api/byus-day/rsvp") {
  return new Request(url, { method: "POST", headers: { origin: "https://byus.kr", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function setup(now = Date.parse("2026-10-02T00:00:00+09:00"), encryptionKey = Buffer.alloc(32, 7)) { const submit = vi.fn().mockResolvedValue(undefined); return { submit, handle: createRsvpHandler({ repository: { submit }, secret: "test-key", encryptionKey, vercel: true, now: () => now }) }; }

describe("ByUs Day RSVP API", () => {
  it("normalizes contact fields and always acknowledges accepted retries with 202", async () => {
    const { submit, handle } = setup();
    const responses = await Promise.all([handle(request()), handle(request())]);
    for (const response of responses) {
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "accepted" });
    }
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: input.idempotencyKey.toLowerCase(), phone: "+821012345678", email: "byeol@example.com", nationality: "KR", residentRegistrationNumberEncrypted: expect.stringMatching(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{18}$/u) }), expect.stringMatching(/^[a-f0-9]{64}$/u), expect.stringMatching(/^[a-f0-9]{64}$/u));
    expect(submit.mock.calls[0]![0]).not.toHaveProperty("residentRegistrationNumber");
    expect(JSON.stringify(submit.mock.calls)).not.toContain("9001011234567");
    const envelope = submit.mock.calls[0]![0].residentRegistrationNumberEncrypted.split(".");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.from(envelope[1]!, "base64url"));
    decipher.setAAD(rsvpEncryptionAad(input.idempotencyKey.toLowerCase()));
    decipher.setAuthTag(Buffer.from(envelope[2]!, "base64url"));
    expect(Buffer.concat([decipher.update(Buffer.from(envelope[3]!, "base64url")), decipher.final()]).toString()).toBe("9001011234567");
  });

  it("accepts an explicit international number independently of nationality", async () => {
    const { submit, handle } = setup();
    expect((await handle(request({ ...input, phone: "+1 202 555 0100", nationality: "US", residentRegistrationNumber: "900101-1234567" }))).status).toBe(202);
    expect(submit.mock.calls[0]![0]).toMatchObject({ phone: "+12025550100", nationality: "US" });
  });

  it.each([
    { consent: false }, { koreanName: "" }, { englishName: "a\nb" }, { phone: "123" }, { phone: "call 010-1234-5678" }, { nationality: "ZZ" },
    { email: "person@example.com\r\nBcc:x@example.com" }, { residentRegistrationNumber: "991332-1234567" }, { residentRegistrationNumber: "900101-9234567" }, { residentRegistrationNumber: "900101123" }, { locale: "fr" }, { idempotencyKey: "bad" },
  ])("rejects invalid, extra, and resident-registration fields %j", async (change) => {
    const { submit, handle } = setup();
    expect((await handle(request({ ...input, ...change }))).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("enforces the actual 16KB body and same-origin request", async () => {
    const { submit, handle } = setup();
    expect((await handle(request(" ".repeat(16_385), { "content-length": "1" }))).status).toBe(400);
    expect((await handle(request(input, { origin: "https://evil.example" }))).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("accepts the last millisecond of October 12 KST", async () => {
    const { submit, handle } = setup(Date.parse("2026-10-12T14:59:59.999Z"));
    expect((await handle(request())).status).toBe(202);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("closes at 2026-10-13 00:00 KST before touching the repository", async () => {
    const { submit, handle } = setup(Date.parse("2026-10-12T15:00:00.000Z"));
    expect((await handle(request())).status).toBe(410);
    expect(submit).not.toHaveBeenCalled();
  });

  it("binds the normalized RRN into the idempotency hash", async () => {
    const a = setup(); const b = setup(); const changed = setup();
    await a.handle(request({ ...input, residentRegistrationNumber: "900101-1234567" }));
    await b.handle(request({ ...input, residentRegistrationNumber: "9001011234567" }));
    await changed.handle(request({ ...input, residentRegistrationNumber: "900101-1234568" }));
    expect(a.submit.mock.calls[0]![2]).toBe(b.submit.mock.calls[0]![2]);
    expect(a.submit.mock.calls[0]![2]).not.toBe(changed.submit.mock.calls[0]![2]);
  });

  it("never reaches the repository with an invalid endpoint-only encryption key", async () => {
    expect(() => parseRsvpEncryptionKey(undefined)).toThrow("RSVP_ENCRYPTION_KEY_INVALID");
    expect(() => parseRsvpEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow("RSVP_ENCRYPTION_KEY_INVALID");
    const { submit, handle } = setup(undefined, Buffer.alloc(31));
    expect((await handle(request())).status).toBe(503);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["RSVP_CLOSED", "RSVP_RATE_LIMITED", "RSVP_IDEMPOTENCY_CONFLICT", "RSVP_UNAVAILABLE"] as const)("maps %s without leaking database details", async (code) => {
    const { submit, handle } = setup(); submit.mockRejectedValue(new RsvpError(code));
    const response = await handle(request());
    expect(await response.json()).toEqual({ error: { code } });
    expect(response.status).toBe({ RSVP_CLOSED: 410, RSVP_RATE_LIMITED: 429, RSVP_IDEMPOTENCY_CONFLICT: 409, RSVP_UNAVAILABLE: 503 }[code]);
  });
});
