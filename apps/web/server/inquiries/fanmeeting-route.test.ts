import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInquiryHandler, InquiryError, normalizedClientIp, type InquiryType } from "./fanmeeting-route";
const input = { idempotencyKey: "11111111-1111-4111-8111-111111111111", locale: "ko", name: "담당자", company: "Company", email: "sender@example.com", message: "문의합니다", consent: true };
function request(body: unknown = input, headers: Record<string, string> = {}, url = "https://byus.kr/api/inquiries/fanmeeting") {
  return new Request(url, { method: "POST", headers: { origin: "https://byus.kr", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function setup(inquiryType: InquiryType = "fanmeeting") { const submit = vi.fn().mockResolvedValue(false); return { submit, handle: createInquiryHandler({ repository: { submit }, secret: "test-key", vercel: true, inquiryType }) }; }
describe("public inquiry API", () => {
  it("accepts validated payload and hashes IP and payload server-side", async () => {
    const { submit, handle } = setup(); const result = await handle(request());
    expect(result.status).toBe(202); expect(await result.json()).toEqual({ status: "accepted" });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(submit).toHaveBeenCalledWith(input, expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/), "fanmeeting");
    expect(submit.mock.calls[0][1]).not.toEqual(submit.mock.calls[0][2]);
  });
  it("preserves the legacy fanmeeting payload hash and binds new categories server-side", async () => {
    const legacy = setup("fanmeeting");
    const creator = setup("creator");
    await legacy.handle(request());
    await creator.handle(request());
    const hash = (value: string) => createHmac("sha256", "test-key").update(`byus-inquiry-v1:payload:${value}`).digest("hex");
    const legacyPayload = [input.locale, input.name, input.company, input.email, input.message, input.consent];
    expect(legacy.submit.mock.calls[0][2]).toBe(hash(JSON.stringify(legacyPayload)));
    expect(creator.submit.mock.calls[0][2]).toBe(hash(JSON.stringify(["creator", ...legacyPayload])));
    expect(creator.submit.mock.calls[0][3]).toBe("creator");
  });
  it("replays as 200 and forwards exact idempotency identity", async () => {
    const { submit, handle } = setup(); submit.mockResolvedValue(true);
    expect((await handle(request())).status).toBe(200); expect(submit.mock.calls[0][0].idempotencyKey).toBe(input.idempotencyKey);
  });
  it.each([{ consent: false }, { name: "" }, { email: "person@example.com\r\nBcc:other@example.com" }, { message: "a".repeat(4001) }, { recipients: ["other@example.com"] }, { inquiryType: "partner" }, { locale: "fr" }, { idempotencyKey: "bad" }])("rejects invalid or extra fields %j", async (change) => {
    const { submit, handle } = setup(); expect((await handle(request({ ...input, ...change }))).status).toBe(400); expect(submit).not.toHaveBeenCalled();
  });
  it("bounds actual bytes despite a small declared Content-Length", async () => {
    const { submit, handle } = setup();
    expect((await handle(request(" ".repeat(16385), { "content-length": "1" }))).status).toBe(400); expect(submit).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: "https://evil.example" }, { origin: "null" }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }])("rejects origin/content violations %j", async (headers) => {
    const { submit, handle } = setup(); expect((await handle(request(input, headers))).status).toBe(400); expect(submit).not.toHaveBeenCalled();
  });
  it("does not derive trusted origin from the request Host", async () => {
    const { handle } = setup(); expect((await handle(request(input, { origin: "https://evil.example" }, "https://evil.example/api"))).status).toBe(400);
  });
  it("does not trust arbitrary forwarded-for when Vercel IP is missing", async () => {
    const { submit, handle } = setup(); expect((await handle(request(input, { "x-vercel-forwarded-for": "", "x-forwarded-for": "192.0.2.8" }))).status).toBe(503); expect(submit).not.toHaveBeenCalled();
  });
  it.each(["INQUIRY_RATE_LIMITED", "INQUIRY_IDEMPOTENCY_CONFLICT", "INQUIRY_UNAVAILABLE"] as const)("maps %s without leaking data", async (code) => {
    const { submit, handle } = setup(); submit.mockRejectedValue(new InquiryError(code)); const res = await handle(request()); expect(await res.json()).toEqual({ error: { code } }); expect(res.status).toBe({ INQUIRY_RATE_LIMITED: 429, INQUIRY_IDEMPOTENCY_CONFLICT: 409, INQUIRY_UNAVAILABLE: 503 }[code]);
  });
  it("masks unknown database details", async () => {
    const { submit, handle } = setup(); submit.mockRejectedValue(new Error("sender@example.com SQL")); expect(await (await handle(request())).json()).toEqual({ error: { code: "INQUIRY_UNAVAILABLE" } });
  });
  it("normalizes IPv6 textual aliases and ignores spoofed XFF", () => {
    const a = normalizedClientIp(request(input, { "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1", "x-forwarded-for": "10.0.0.2" }), true);
    const b = normalizedClientIp(request(input, { "x-vercel-forwarded-for": "2001:db8::1" }), true); expect(a).toBe(b);
    expect(() => normalizedClientIp(request(input, { "x-vercel-forwarded-for": "192.0.2.1,192.0.2.2" }), true)).toThrow();
  });
});
