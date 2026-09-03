import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createSupabaseBenefitFulfillmentRepository } from "./benefit-fulfillment-repository";
it("writes recipient data only through the owner RPC", async () => {
  const rpc = vi.fn(async () => ({ data: { status: "ready" }, error: null }));
  const repository = createSupabaseBenefitFulfillmentRepository({ url: "x", serviceRoleKey: "x" }, { rpc } as never);
  await repository.saveRecipient({ appUserId: "owner", winnerId: "winner", correlationId: "correlation", recipient: { consentVersion: "2026-09-v1", consented: true, name: "홍길동", phone: "010-1234-5678", postalCode: "12345", address1: "서울" } });
  expect(rpc).toHaveBeenCalledWith("save_owned_benefit_recipient", expect.objectContaining({ p_app_user_id: "owner", p_consented: true }));
});
