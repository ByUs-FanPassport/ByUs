import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInquiryRepository } from "./fanmeeting-repository";
const input = { idempotencyKey: "11111111-1111-4111-8111-111111111111", locale: "ko" as const, name: "Contact", company: "Company", email: "a@example.com", message: "Hello", consent: true as const };
it("only forwards the fixed submit contract", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  expect(await createInquiryRepository({ rpc }).submit(input, "a".repeat(64), "b".repeat(64), "fanmeeting")).toBe(false);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_business_inquiry", { p_id: input.idempotencyKey, p_locale: "ko", p_name: "Contact", p_company: "Company", p_email: "a@example.com", p_message: "Hello", p_consent: true, p_ip_hash: "a".repeat(64), p_payload_hash: "b".repeat(64) });
});
it.each(["creator", "partner"] as const)("uses the category-capable RPC for %s", async inquiryType => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  expect(await createInquiryRepository({ rpc }).submit(input, "a".repeat(64), "b".repeat(64), inquiryType)).toBe(false);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_categorized_business_inquiry", {
    p_id: input.idempotencyKey, p_locale: "ko", p_name: "Contact", p_company: "Company",
    p_email: "a@example.com", p_message: "Hello", p_consent: true,
    p_ip_hash: "a".repeat(64), p_payload_hash: "b".repeat(64), p_inquiry_type: inquiryType,
  });
});
it.each(["INQUIRY_RATE_LIMITED", "INQUIRY_IDEMPOTENCY_CONFLICT", "INQUIRY_INVALID"])("maps exact safe database code %s", async code => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: code }, data: null });
  await expect(createInquiryRepository({ rpc }).submit(input,"a","b","fanmeeting")).rejects.toMatchObject({ code });
});
it("rejects unexpected result and masks SQL details", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: { success: true } });
  const repo = createInquiryRepository({ rpc });
  await expect(repo.submit(input,"a","b","fanmeeting")).rejects.toMatchObject({ code: "INQUIRY_UNAVAILABLE" });
  rpc.mockResolvedValue({ error: { message: "PII detail" }, data: null });
  await expect(repo.submit(input,"a","b","fanmeeting")).rejects.toMatchObject({ message: "INQUIRY_UNAVAILABLE" });
});
