import { describe, expect, it, vi } from "vitest";
import { SupabaseExternalNotificationQueue } from "../src/adapters/supabase-external-notification-queue.js";

describe("external notification channel isolation", () => {
  it.each([[false,"claim_external_notification_deliveries"],[true,"claim_email_notification_deliveries"]] as const)("routes email-only=%s to the matching claim RPC", async (emailOnly, name) => {
    const rpc = vi.fn(async () => ({data: [], error:null}));
    const queue = new SupabaseExternalNotificationQueue({rpc} as never,"dev",emailOnly);
    await expect(queue.claim("ses-worker",25,120)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(name,{p_worker_id:"ses-worker",p_batch_size:25,p_lease_seconds:120});
  });
  it("does not fall back to claiming every channel if the email RPC is missing", async () => {
    const rpc=vi.fn(async () => ({data:null,error:{code:"PGRST202"}}));
    const queue=new SupabaseExternalNotificationQueue({rpc} as never,"dev",true);
    await expect(queue.claim("ses-worker",25,120)).rejects.toThrow("claim failed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

it.each([true,false])( "returns final email eligibility %s from the lease-aware RPC",async(eligible)=>{
 const rpc=vi.fn(async()=>({data:eligible,error:null}));
 const queue=new SupabaseExternalNotificationQueue({rpc} as never,"dev",true);
 const job={id:"delivery",leaseOwner:"ses-worker"} as Parameters<typeof queue.revalidateEmail>[0];
 await expect(queue.revalidateEmail(job)).resolves.toBe(eligible);
 expect(rpc).toHaveBeenCalledExactlyOnceWith("revalidate_email_notification_delivery",{p_delivery_id:"delivery",p_worker_id:"ses-worker"});
});
it("does not treat an unavailable final eligibility RPC as permission to send",async()=>{
 const rpc=vi.fn(async()=>({data:null,error:{code:"PGRST202"}}));
 const queue=new SupabaseExternalNotificationQueue({rpc} as never,"dev",true);
 await expect(queue.revalidateEmail({id:"d",leaseOwner:"w"} as never)).rejects.toThrow("email revalidation failed");
});
