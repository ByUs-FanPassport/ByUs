import{describe,expect,it,vi}from"vitest";
import{ExternalNotificationError,type ExternalNotificationJob}from"../src/external-notification-domain.js";
import type{ExternalNotificationQueue}from"../src/external-notification-ports.js";
import{ExternalNotificationWorker}from"../src/external-notification-worker.js";
const job:ExternalNotificationJob={id:"d",notificationId:"n",planId:"p",channel:"kakao",sequence:1,templateKey:"live:reserved",locale:"ko",destination:"test:kakao",payload:{title:"t",detail:"d",deepLink:"/my"},attemptCount:1,leaseOwner:"worker",leaseExpiresAt:"2099-01-01T00:00:00Z"};
function queue(items=[job]):ExternalNotificationQueue{return{claim:vi.fn(async()=>items),revalidateEmail:vi.fn(async()=>true),beginEmail:vi.fn(async()=>true),finishEmail:vi.fn(),complete:vi.fn(),fail:vi.fn(),recordSink:vi.fn()};}
describe("ExternalNotificationWorker",()=>{
 it("completes a leased Kakao primary once",async()=>{const q=queue();const send=vi.fn(async()=>({providerMessageId:"m"}));expect(await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce()).toBe(1);expect(q.complete).toHaveBeenCalledWith(job,"m");});
 it("does not prematurely fallback for retryable failures",async()=>{const q=queue();const send=vi.fn(async()=>{throw new ExternalNotificationError("KAKAO_RETRYABLE",true)});await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(q.fail).toHaveBeenCalledWith(job,{code:"KAKAO_RETRYABLE",retryable:true});});
 it("marks permanent primary failure so the queue can schedule sequence two exactly once",async()=>{const q=queue();const send=vi.fn(async()=>{throw new ExternalNotificationError("KAKAO_REJECTED",false)});await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(q.fail).toHaveBeenCalledWith(job,{code:"KAKAO_REJECTED",retryable:false});});
 it("never sends an expired lease",async()=>{const q=queue([{...job,leaseExpiresAt:"2020-01-01T00:00:00Z"}]);const send=vi.fn();await new ExternalNotificationWorker(q,{kakao:{send},email:{send}}, {workerId:"worker",batchSize:25,leaseSeconds:120}).runOnce();expect(send).not.toHaveBeenCalled();});
});

it("sends 40 distinct emails once with at least 200ms between provider calls",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
 try {
  const emails=Array.from({length:40},(_,index)=>({...job,id:`email-${index}`,notificationId:`notification-${index}`,channel:"email" as const,templateKey:"live_reserved",destination:`fan-${index}@example.invalid`,leaseExpiresAt:"2026-10-09T00:05:00Z"}));
  const q=queue(emails);const starts:number[]=[];
  const send=vi.fn(async()=>{starts.push(Date.now());return{providerMessageId:`ses-${starts.length}`};});
  const run=new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:40,leaseSeconds:300,remainingTimeInMillis:()=>300_000}).runOnce();
  await vi.runAllTimersAsync();
  await expect(run).resolves.toBe(40);
  expect(q.beginEmail).toHaveBeenCalledTimes(40);expect(new Set(vi.mocked(q.beginEmail).mock.calls.map(([value])=>value.id)).size).toBe(40);
  expect(send).toHaveBeenCalledTimes(40);expect(starts.slice(1).every((time,index)=>time-starts[index]!>=200)).toBe(true);
 } finally {vi.useRealTimers();}
});

it("stops before the durable begin when a slow SES send leaves under 30 seconds",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
 try {
  const emails=[0,1].map(index=>({...job,id:`email-${index}`,channel:"email" as const,templateKey:"live_reserved",leaseExpiresAt:"2026-10-09T00:05:00Z"}));
  const q=queue(emails);const deadline=Date.now()+46_000;
  const send=vi.fn(async()=>{await new Promise(resolve=>setTimeout(resolve,17_000));return{providerMessageId:"ses"};});
  const run=new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:40,leaseSeconds:300,remainingTimeInMillis:()=>deadline-Date.now()}).runOnce();
  await vi.runAllTimersAsync();await run;
  expect(q.beginEmail).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);expect(q.revalidateEmail).toHaveBeenCalledTimes(1);
 } finally {vi.useRealTimers();}
});

it("stops before the durable begin when a slow revalidation leaves under 30 lease seconds",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
 try {
  const email={...job,channel:"email" as const,templateKey:"live_reserved",leaseExpiresAt:"2026-10-09T00:00:32Z"};
  const q=queue([email]);vi.mocked(q.revalidateEmail).mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,3_000));return true;});
  const send=vi.fn();const run=new ExternalNotificationWorker(q,{kakao:{send},email:{send}},{workerId:"worker",batchSize:40,leaseSeconds:300,remainingTimeInMillis:()=>300_000}).runOnce();
  await vi.runAllTimersAsync();await run;
  expect(q.revalidateEmail).toHaveBeenCalledOnce();expect(q.beginEmail).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 } finally {vi.useRealTimers();}
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
