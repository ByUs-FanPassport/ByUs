import { describe, expect, it, vi } from "vitest";
import { createRsvpHandler, RsvpError } from "./rsvp-route";

const input = { idempotencyKey: "11111111-1111-4111-8111-111111111111", locale: "ko", koreanName: "김별", englishName: "Byeol Kim", phone: "010-1234-5678", affiliation: "ByUs", occupation: "기획", email: "BYEOL@example.com", nationality: "kr", consent: true };
function request(body: unknown = input, headers: Record<string, string> = {}, url = "https://byus.kr/api/byus-day/rsvp") {
  return new Request(url, { method: "POST", headers: { origin: "https://byus.kr", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function setup(now = Date.parse("2026-10-02T00:00:00+09:00")) { const submit = vi.fn().mockResolvedValue(undefined); return { submit, handle: createRsvpHandler({ repository: { submit }, secret: "test-key", vercel: true, now: () => now }) }; }

describe("ByUs Day RSVP API", () => {
  it("normalizes contact fields and always acknowledges accepted retries with 202", async () => {
    const { submit, handle } = setup();
    for (let index = 0; index < 2; index += 1) expect((await handle(request())).status).toBe(202);
    expect(submit).toHaveBeenCalledWith({ ...input, phone: "+821012345678", email: "byeol@example.com", nationality: "KR" }, expect.stringMatching(/^[a-f0-9]{64}$/u), expect.stringMatching(/^[a-f0-9]{64}$/u));
  });

  it("accepts an explicit international number independently of nationality", async () => {
    const { submit, handle } = setup();
    expect((await handle(request({ ...input, phone: "+1 202 555 0100", nationality: "JP" }))).status).toBe(202);
    expect(submit.mock.calls[0]![0]).toMatchObject({ phone: "+12025550100", nationality: "JP" });
  });

  it.each([
    { consent: false }, { koreanName: "" }, { englishName: "a\nb" }, { phone: "123" }, { phone: "call 010-1234-5678" }, { nationality: "ZZ" },
    { email: "person@example.com\r\nBcc:x@example.com" }, { residentRegistrationNumber: "000000-0000000" }, { locale: "fr" }, { idempotencyKey: "bad" },
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

  it("closes at 2026-10-23 00:00 KST before touching the repository", async () => {
    const { submit, handle } = setup(Date.parse("2026-10-22T15:00:00.000Z"));
    expect((await handle(request())).status).toBe(410);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["RSVP_CLOSED", "RSVP_RATE_LIMITED", "RSVP_IDEMPOTENCY_CONFLICT", "RSVP_UNAVAILABLE"] as const)("maps %s without leaking database details", async (code) => {
    const { submit, handle } = setup(); submit.mockRejectedValue(new RsvpError(code));
    const response = await handle(request());
    expect(await response.json()).toEqual({ error: { code } });
    expect(response.status).toBe({ RSVP_CLOSED: 410, RSVP_RATE_LIMITED: 429, RSVP_IDEMPOTENCY_CONFLICT: 409, RSVP_UNAVAILABLE: 503 }[code]);
  });
});
