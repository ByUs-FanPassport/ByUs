import{afterEach,expect,it,vi}from"vitest";import{EmailSender}from"../src/adapters/email-sender.js";
const job={id:"delivery",notificationId:"n",planId:"p",channel:"email" as const,sequence:1 as const,templateKey:"live_reserved",locale:"ko" as const,destination:"test@example.com",payload:{title:"t",detail:"d",deepLink:"/my"},attemptCount:1,leaseOwner:"w",leaseExpiresAt:"2099-01-01T00:00:00Z"};afterEach(()=>vi.unstubAllGlobals());
it("uses the delivery id as provider idempotency key",async()=>{const fetch=vi.fn(async()=>new Response(JSON.stringify({id:"m"}),{status:200}));vi.stubGlobal("fetch",fetch);await new EmailSender({url:"https://email.test/send",token:"x".repeat(16)}).send(job);expect(fetch).toHaveBeenCalledWith("https://email.test/send",expect.objectContaining({headers:expect.objectContaining({"idempotency-key":"delivery"})}));});
it.each(["live_24h", "live_cancelled"])("never sends excluded %s to the HTTP email provider", async(templateKey)=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect(new EmailSender({url:"https://email.test/send",token:"x".repeat(16)}).send({...job,templateKey})).rejects.toMatchObject({retryable:false});
 expect(fetch).not.toHaveBeenCalled();
});
it("sends localized subject and body to the HTTP provider",async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({id:"m"}),{status:200}));vi.stubGlobal("fetch",fetch);
 await new EmailSender({url:"https://email.test/send",token:"x".repeat(16)}).send({...job,locale:"en",payload:{...job.payload,title:"한국어 제목",detail:"한국어 본문"}});
 const body=JSON.parse((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
 expect(body.subject).not.toMatch(/[가-힣]/);expect(body.html).not.toMatch(/[가-힣]/);expect(body.deepLink).toBe("https://byus.kr/my?locale=en");
});
