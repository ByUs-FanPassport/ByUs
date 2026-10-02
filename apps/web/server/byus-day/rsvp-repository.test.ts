import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRsvpRepository } from "./rsvp-repository";
import type { RsvpInput } from "./rsvp-route";

const input: RsvpInput = { idempotencyKey: "11111111-1111-4111-8111-111111111111", locale: "ko", koreanName: "김별", englishName: "Byeol Kim", phone: "+821012345678", affiliation: "ByUs", occupation: "기획", email: "byeol@example.com", nationality: "KR", residentRegistrationNumberEncrypted: `v1.${"a".repeat(16)}.${"b".repeat(22)}.${"c".repeat(18)}`, consent: true };

it("calls only the service-role RSVP RPC and accepts its generic acknowledgement", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  await createRsvpRepository({ rpc }).submit(input, "a".repeat(64), "b".repeat(64));
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_byus_day_rsvp", { p_id: input.idempotencyKey, p_locale: "ko", p_korean_name: "김별", p_english_name: "Byeol Kim", p_phone_e164: "+821012345678", p_affiliation: "ByUs", p_occupation: "기획", p_email: "byeol@example.com", p_nationality: "KR", p_resident_registration_number_encrypted: input.residentRegistrationNumberEncrypted, p_consent: true, p_ip_hash: "a".repeat(64), p_payload_hash: "b".repeat(64) });
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/900101-?1234567/u);
});

it.each(["RSVP_INVALID", "RSVP_CLOSED", "RSVP_RATE_LIMITED", "RSVP_IDEMPOTENCY_CONFLICT"] as const)("maps the exact safe database code %s", async (code) => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: code } });
  await expect(createRsvpRepository({ rpc }).submit(input, "a", "b")).rejects.toMatchObject({ code });
});

it("masks unexpected database results and details", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "private SQL detail" } });
  await expect(createRsvpRepository({ rpc }).submit(input, "a", "b")).rejects.toMatchObject({ code: "RSVP_UNAVAILABLE" });
});
