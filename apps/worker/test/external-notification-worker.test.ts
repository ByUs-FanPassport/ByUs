import{describe,expect,it,vi}from"vitest";
import{ExternalNotificationError,type ExternalNotificationJob}from"../src/external-notification-domain.js";
import type{ExternalNotificationQueue}from"../src/external-notification-ports.js";
import{ExternalNotificationWorker}from"../src/external-notification-worker.js";
const job:ExternalNotificationJob={id:"d",notificationId:"n",planId:"p",channel:"kakao",sequence:1,templateKey:"live:reserved",locale:"ko",destination:"test:kakao",payload:{title:"t",detail:"d",deepLink:"/my"},attemptCount:1,leaseOwner:"worker",leaseExpiresAt:"2099-01-01T00:00:00Z"};
function queue(items=[job]):ExternalNotificationQueue{return{claim:vi.fn(async()=>items),revalidateEmail:vi.fn(async()=>true),complete:vi.fn(),fail:vi.fn(),recordSink:vi.fn()};}
describe("ExternalNotificationWorker",()=>{
 it("completes a leased Kakao primary once",async()=>{const q=queue();const send=vi.fn(async()=>({providerMessageId:"m"}));expect(await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce()).toBe(1);expect(q.complete).toHaveBeenCalledWith(job,"m");});
 it("does not prematurely fallback for retryable failures",async()=>{const q=queue();const send=vi.fn(async()=>{throw new ExternalNotificationError("KAKAO_RETRYABLE",true)});await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(q.fail).toHaveBeenCalledWith(job,{code:"KAKAO_RETRYABLE",retryable:true});});
 it("marks permanent primary failure so the queue can schedule sequence two exactly once",async()=>{const q=queue();const send=vi.fn(async()=>{throw new ExternalNotificationError("KAKAO_REJECTED",false)});await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(q.fail).toHaveBeenCalledWith(job,{code:"KAKAO_REJECTED",retryable:false});});
 it("never sends an expired lease",async()=>{const q=queue([{...job,leaseExpiresAt:"2020-01-01T00:00:00Z"}]);const send=vi.fn();await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(send).not.toHaveBeenCalled();});
});

it.each(["live_24h", "live_cancelled"])("blocks %s emails before provider and preserves Kakao", async(templateKey)=>{
 const email={...job,channel:"email" as const,templateKey};
 const q=queue([email,{...job,templateKey}]);const send=vi.fn(async()=>({providerMessageId:"m"}));
 await new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();
 expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]).toEqual([{...job,templateKey}]);
 expect(q.fail).toHaveBeenCalledWith(email,expect.objectContaining({retryable:false}));
});
it("does not send or complete an email suppressed by final eligibility validation",async()=>{
 const email={...job,channel:"email" as const,templateKey:"live_reserved"};const q=queue([email]);
 vi.mocked(q.revalidateEmail).mockResolvedValue(false);const send=vi.fn();
 await new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();
 expect(q.revalidateEmail).toHaveBeenCalledWith(email);expect(send).not.toHaveBeenCalled();expect(q.complete).not.toHaveBeenCalled();
});
it("fails closed and retries when final email validation cannot reach the database",async()=>{
 const email={...job,channel:"email" as const,templateKey:"live_reserved"};const q=queue([email]);
 vi.mocked(q.revalidateEmail).mockRejectedValue(new Error("offline"));const send=vi.fn();
 await new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();
 expect(send).not.toHaveBeenCalled();expect(q.fail).toHaveBeenCalledWith(email,{code:"EXTERNAL_UNEXPECTED",retryable:true});
});
