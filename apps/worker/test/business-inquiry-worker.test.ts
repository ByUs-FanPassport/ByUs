import { describe, expect, it, vi } from "vitest";
import { BusinessInquiryWorker, InquirySendError, SesInquirySender, SupabaseInquiryQueue, type BusinessInquiry } from "../src/business-inquiry-worker.js";
const job: BusinessInquiry = { id: "11111111-1111-4111-8111-111111111111", attempt_token: "22222222-2222-4222-8222-222222222222", locale: "ko", contact_name: "문의자", company: "Company", email: "sender@example.com", message: "미국 팬미팅 문의\n일정을 상담하고 싶어요." };
function setup() {
  const queue = { maintain: vi.fn().mockResolvedValue(undefined), claim: vi.fn().mockResolvedValue(job), begin: vi.fn().mockResolvedValue(true), finish: vi.fn().mockResolvedValue(undefined) };
  const sender = { send: vi.fn().mockResolvedValue("ses-id") };
  return { queue, sender, worker: new BusinessInquiryWorker(queue, sender) };
}
describe("inquiry durable send boundary", () => {
  it("maintains retention even when sending is disabled", async () => {
    const { queue } = setup();
    expect(await new BusinessInquiryWorker(queue, null).runOnce()).toBe(0);
    expect(queue.maintain).toHaveBeenCalledOnce(); expect(queue.claim).not.toHaveBeenCalled();
  });
  it("commits sending before SES and erases via success ack", async () => {
    const { queue, sender, worker } = setup();
    expect(await worker.runOnce()).toBe(1);
    expect(queue.begin.mock.invocationCallOrder[0]).toBeLessThan(sender.send.mock.invocationCallOrder[0]!);
    expect(queue.finish).toHaveBeenCalledExactlyOnceWith(job, "sent", "ses-id");
  });
  it("does not send if durable sending response is lost", async () => {
    const { queue, sender, worker } = setup(); queue.begin.mockRejectedValue(new Error("lost response"));
    await expect(worker.runOnce()).rejects.toThrow(); expect(sender.send).not.toHaveBeenCalled(); expect(queue.finish).not.toHaveBeenCalled();
  });
  it("does not send under a stale token", async () => {
    const { queue, sender, worker } = setup(); queue.begin.mockResolvedValue(false);
    expect(await worker.runOnce()).toBe(0); expect(sender.send).not.toHaveBeenCalled();
  });
  it("does not turn a successful SES send with failed ack into retry", async () => {
    const { queue, sender, worker } = setup(); queue.finish.mockRejectedValue(new Error("ack lost"));
    await expect(worker.runOnce()).rejects.toThrow(); expect(sender.send).toHaveBeenCalledOnce();
    expect(queue.finish).toHaveBeenCalledExactlyOnceWith(job, "sent", "ses-id");
  });
  it.each(["unknown", "throttled", "rejected"] as const)("records only the classified %s outcome", async (outcome) => {
    const { queue, sender, worker } = setup(); sender.send.mockRejectedValue(new InquirySendError(outcome));
    expect(await worker.runOnce()).toBe(0); expect(queue.finish).toHaveBeenCalledExactlyOnceWith(job, outcome);
  });
  it("unknown untyped failure cannot trigger retry", async () => {
    const { queue, sender, worker } = setup(); sender.send.mockRejectedValue(new Error("PII detail"));
    await worker.runOnce(); expect(queue.finish).toHaveBeenCalledExactlyOnceWith(job, "unknown");
  });
});
describe("SES inquiry envelope", () => {
  it("fixes To/CC and replies to the submitter with plain UTF-8 text", async () => {
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-id" });
    await new SesInquirySender({ send }).send(job);
    const input = send.mock.calls[0]![0].input;
    expect(input.FromEmailAddress).toBe("notifications@byus.kr");
    expect(input.Destination).toEqual({ ToAddresses: ["biz@sallylab.io"], CcAddresses: ["jongho@sallylab.io", "jaeyeong@sallylab.io"] });
    expect(input.ReplyToAddresses).toEqual([job.email]);
    expect(input.Content.Simple.Body.Text.Data).toContain(job.message);
    expect(input.Content.Simple.Body.Html).toBeUndefined();
  });
  it.each(["TimeoutError", "InternalServerError", "RequestTimeout", "Error"])("classifies %s as ambiguous without logging provider detail", async (name) => {
    const send = vi.fn().mockRejectedValue({ name, message: "private contact" });
    await expect(new SesInquirySender({ send }).send(job)).rejects.toMatchObject({ outcome: "unknown", message: "INQUIRY_UNKNOWN" });
    expect(send).toHaveBeenCalledOnce();
  });
  it("throttles only explicit rejection and treats absent MessageId as unknown", async () => {
    await expect(new SesInquirySender({ send: vi.fn().mockRejectedValue({ name: "TooManyRequestsException" }) }).send(job)).rejects.toMatchObject({ outcome: "throttled" });
    await expect(new SesInquirySender({ send: vi.fn().mockResolvedValue({}) }).send(job)).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("rejects reply-to header injection without sending", async () => {
    const send = vi.fn(); await expect(new SesInquirySender({ send }).send({ ...job, email: "person@example.com\r\nBcc: other@example.com" })).rejects.toMatchObject({ outcome: "rejected" }); expect(send).not.toHaveBeenCalled();
  });
});
it("queue binds every state transition to the attempt token and masks raw errors", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null }); const q = new SupabaseInquiryQueue({ rpc });
  await q.begin(job); await q.finish(job, "sent", "id");
  expect(rpc).toHaveBeenCalledWith("begin_business_inquiry_send", { p_id: job.id, p_token: job.attempt_token });
  expect(rpc).toHaveBeenCalledWith("finish_business_inquiry", { p_id: job.id, p_token: job.attempt_token, p_outcome: "sent", p_provider_id: "id" });
  rpc.mockResolvedValue({ error: { message: "private" }, data: null });
  await expect(q.claim()).rejects.toThrow("BUSINESS_INQUIRY_QUEUE_UNAVAILABLE");
});
