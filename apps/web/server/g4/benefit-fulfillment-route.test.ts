import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPostOwnedBenefitRecipientHandler, type BenefitFulfillmentRouteDependencies } from "./benefit-fulfillment-route";
const winnerId = "11111111-1111-4111-8111-111111111111";
function deps(): BenefitFulfillmentRouteDependencies { return { authorize: vi.fn(async () => ({ appUserId: "owner" })), repository: { saveRecipient: vi.fn(async () => ({ status: "ready" })) } }; }
describe("owned Benefit recipient route", () => {
  it("uses the authenticated owner and server correlation", async () => {
    const d=deps(); const response=await createPostOwnedBenefitRecipientHandler(d)(new Request("https://byus.test",{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json"},body:JSON.stringify({consentVersion:"2026-09-v1",consented:true,name:"홍길동",phone:"010-1234-5678",postalCode:"12345",address1:"서울"})}),{winnerId});
    expect(response.status).toBe(200); expect(d.repository.saveRecipient).toHaveBeenCalledWith(expect.objectContaining({appUserId:"owner",winnerId,correlationId:expect.any(String)}));
  });
  it("rejects false consent before repository access", async () => {
    const d=deps(); const response=await createPostOwnedBenefitRecipientHandler(d)(new Request("https://byus.test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({consentVersion:"2026-09-v1",consented:false,name:"A",phone:"01012345678"})}),{winnerId});
    expect(response.status).toBe(400); expect(d.repository.saveRecipient).not.toHaveBeenCalled();
  });
});
