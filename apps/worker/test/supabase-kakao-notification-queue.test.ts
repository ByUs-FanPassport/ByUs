import { expect, it, vi } from "vitest";
import { SupabaseKakaoNotificationQueue } from "../src/adapters/supabase-kakao-notification-queue.js";

const row = {
  id:"delivery",attempt_token:"attempt",notification_id:"notification",
  template_key:"live_reserved",locale:"ko",destination:"01012345678",
  payload:{deepLink:"/live/kara?locale=ko",context:{artist:"KARA",title:"Live"}},
  template_id:"template",lease_expires_at:"2099-01-01T00:00:00Z",
};

it("uses only the dedicated Kakao RPC contracts", async () => {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_kakao_notification_deliveries") return {data:[row],error:null};
    if (name === "claim_kakao_notification_reconciliations") return {data:[{
      id:"delivery",provider_message_id:"message",group_id:"group",
      destination_fingerprint:"fingerprint",template_id:"template",status:"accepted",
    }],error:null};
    return {data:true,error:null};
  });
  const queue = new SupabaseKakaoNotificationQueue({rpc} as never);
  await queue.maintain();
  const [job] = await queue.claim("worker",2,120);
  expect(job).toMatchObject({id:"delivery",attemptToken:"attempt",templateId:"template"});
  await queue.begin(job!,"template","hash");
  await queue.recordSubmission(job!,{outcome:"accepted",providerMessageId:"message",groupId:"group",errorCode:null});
  const [pending] = await queue.claimReconciliations(2);
  await queue.recordResult(pending!,{status:"delivered",statusCode:"4000"});
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "maintain_kakao_notification_deliveries",
    "claim_kakao_notification_deliveries",
    "begin_kakao_notification_send",
    "record_kakao_notification_submission",
    "claim_kakao_notification_reconciliations",
    "record_kakao_notification_result",
  ]);
  expect(rpc).not.toHaveBeenCalledWith(expect.stringContaining("external"),expect.anything());
});
