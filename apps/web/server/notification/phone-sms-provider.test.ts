import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SolapiPhoneSmsProvider } from "./phone-sms-provider";

const input = { phone: "01012345678", code: "012345", challengeId: "11111111-1111-4111-8111-111111111111" };
function setup(response: () => Promise<Response>) {
  const send = vi.fn(response);
  return { send, provider: new SolapiPhoneSmsProvider({ apiKey: "test-api-key", apiSecret: "test-api-secret", sender: "01087654321", fetch: send }) };
}
function accepted() {
  return Response.json({ groupInfo: { groupId: "group_123", count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } }, failedMessageList: [], messageList: [{ messageId: "message_123", statusCode: "2000", customFields: { challengeId: input.challengeId } }] });
}
describe("single phone verification SMS transport", () => {
  it("sends one fixed-purpose SMS and accepts a correlated single result", async () => {
    const { send, provider } = setup(async () => accepted());
    expect(await provider.send(input)).toEqual({ status: "accepted", providerMessageId: "message_123", providerGroupId: "group_123" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.solapi.com/messages/v4/send-many/detail");
    expect(options.redirect).toBe("error");
    const body = JSON.parse(options.body as string);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ type: "SMS", country: "82", from: "01087654321", to: input.phone, customFields: { challengeId: input.challengeId } });
    expect(body.messages[0].text).toContain("012345");
    expect(body.messages[0].text).not.toContain("http");
    expect(body.messages[0]).not.toHaveProperty("kakaoOptions");
  });
  it.each([429, 500])("does not retry ambiguous HTTP %s", async (status) => {
    const { provider, send } = setup(async () => new Response("", { status }));
    expect(await provider.send(input)).toEqual({ status: "unknown" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not retry a timeout", async () => {
    const { provider, send } = setup(async () => { throw new Error("timeout"); });
    expect(await provider.send(input)).toEqual({ status: "unknown" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not trust uncorrelated success", async () => {
    const { provider } = setup(async () => Response.json({ groupInfo: { groupId: "group_123", count: { total: 1, registeredSuccess: 1, registeredFailed: 0 } }, failedMessageList: [], messageList: [{ messageId: "message_123", statusCode: "2000", customFields: { challengeId: "other" } }] }));
    expect(await provider.send(input)).toEqual({ status: "unknown" });
  });
  it.each([{ ...input, phone: "12025550123" }, { ...input, code: "12345" }, { ...input, challengeId: "bad" }])("rejects invalid local input without network", async (bad) => {
    const { provider, send } = setup(async () => accepted());
    expect(await provider.send(bad)).toEqual({ status: "rejected" });
    expect(send).not.toHaveBeenCalled();
  });
});
