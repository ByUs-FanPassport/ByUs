import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  SOLAPI_CHANNEL_ID,
  SOLAPI_PENDING_TEMPLATES,
  SOLAPI_REQUEST_TIMEOUT_MS,
  SOLAPI_MESSAGE_LIST_URL,
  SOLAPI_SEND_MANY_DETAIL_URL,
  SolapiClient,
  type SolapiApprovalRecord,
  type SolapiSubmitInput,
} from "../src/solapi/index.js";

const DELIVERY_ID = "018f47a2-8f4e-7c31-a1c2-12f6af3244a1";
const API_KEY = "test-api-key-123";
const API_SECRET = "test-api-secret-456";
const DATE = new Date("2026-09-07T12:34:56.000Z");
const SALT = "0123456789abcdef0123456789abcdef";
const manifest = SOLAPI_PENDING_TEMPLATES[0];
const approval: SolapiApprovalRecord = {
  templateKey:"live_reserved",
  locale:"ko",
  channelId:SOLAPI_CHANNEL_ID,
  registeredTemplateId:manifest.pendingRegisteredTemplateId,
  verifiedAt:"2026-09-08T09:00:00+09:00",
};
const input: SolapiSubmitInput = {
  id:DELIVERY_ID,
  channel:"kakao",
  locale:"ko",
  destination:"01012345678",
  templateKey:"live_reserved",
  startsAt:"2026-09-08T09:30:00+09:00",
  context:{artist:"KARA",title:"Fan Meeting"},
  deepLink:"/live/kara?locale=ko",
};

function successPayload() {
  return {
    groupInfo:{groupId:"G4Vsafe",count:{total:1,registeredSuccess:1,registeredFailed:0}},
    failedMessageList:[],
    messageList:[{messageId:"M4Vsafe",statusCode:"2000",customFields:{deliveryKey:DELIVERY_ID}}],
  };
}

function client(fetchImpl: typeof fetch, salt: () => string = () => SALT) {
  return new SolapiClient({
    apiKey:API_KEY,
    apiSecret:API_SECRET,
    approvals:[approval],
    fetch:fetchImpl,
    now:() => DATE,
    salt,
  });
}

describe("SolapiClient", () => {
  it("uses the verified default approval registry", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(successPayload()));
    const instance = new SolapiClient({apiKey:API_KEY,apiSecret:API_SECRET,fetch:fetchImpl});
    await expect(instance.submit(input)).resolves.toMatchObject({status:"accepted"});
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("signs with HMAC-SHA256 and sends exactly one fixed, non-redirecting request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(successPayload()));
    await expect(client(fetchImpl).submit(input)).resolves.toEqual({
      status:"accepted",
      receipt:{providerMessageId:"M4Vsafe",groupId:"G4Vsafe"},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(SOLAPI_SEND_MANY_DETAIL_URL);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(SOLAPI_REQUEST_TIMEOUT_MS).toBe(8000);
    const signature = createHmac("sha256", API_SECRET).update(DATE.toISOString() + SALT).digest("hex");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `HMAC-SHA256 apiKey=${API_KEY}, date=${DATE.toISOString()}, salt=${SALT}, signature=${signature}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      allowDuplicates:false,
      messages:[{customFields:{deliveryKey:DELIVERY_ID}}],
    });
  });

  it("requires a fresh 32-hex salt on every call", async () => {
    const salts = ["a".repeat(32), "b".repeat(32)];
    const salt = vi.fn(() => salts.shift()!);
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(successPayload()));
    const instance = client(fetchImpl, salt);
    await instance.submit(input);
    await instance.submit(input);
    expect(salt).toHaveBeenCalledTimes(2);
    const auth = fetchImpl.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"));
    expect(auth[0]).toContain(`salt=${"a".repeat(32)}`);
    expect(auth[1]).toContain(`salt=${"b".repeat(32)}`);
  });

  it("rejects malformed credentials safely without a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await new SolapiClient({
      apiKey:"bad key",
      apiSecret:"short",
      approvals:[approval],
      fetch:fetchImpl,
    }).submit(input);
    expect(result).toEqual({
      status:"unknown",
      code:"SOLAPI_INVALID_CONFIGURATION",
      reconciliation:"DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION",
    });
    expect(JSON.stringify(result)).not.toMatch(/bad key|short|01012345678/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["api,key123", "api=key123"])("rejects API-key authorization delimiters: %s", async (apiKey) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await new SolapiClient({
      apiKey,
      apiSecret:API_SECRET,
      approvals:[approval],
      fetch:fetchImpl,
    }).submit(input);
    expect(result).toMatchObject({status:"unknown",code:"SOLAPI_INVALID_CONFIGURATION"});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies only a fully correlated one-message success as accepted", async () => {
    const contradictory = successPayload();
    contradictory.groupInfo.count.registeredFailed = 1;
    const cases = [
      {...successPayload(),messageList:[{...successPayload().messageList[0],customFields:{deliveryKey:"other"}}]},
      {...successPayload(),messageList:[]},
      contradictory,
      {groupInfo:{groupId:"G4Vsafe",count:{total:1,registeredSuccess:1,registeredFailed:0}}},
    ];
    for (const payload of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(payload));
      await expect(client(fetchImpl).submit(input)).resolves.toMatchObject({status:"unknown",code:"SOLAPI_RESPONSE_UNKNOWN"});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("returns rejected only for one clearly correlated provider failure", async () => {
    const payload = {
      groupInfo:{groupId:"G4Vsafe",count:{total:1,registeredSuccess:0,registeredFailed:1}},
      failedMessageList:[{statusCode:"4002",statusMessage:"do not expose",to:"01012345678",customFields:{deliveryKey:DELIVERY_ID}}],
      messageList:[],
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(payload, {status:400}));
    const result = await client(fetchImpl).submit(input);
    expect(result).toEqual({status:"rejected",code:"SOLAPI_PROVIDER_REJECTED"});
    expect(JSON.stringify(result)).not.toMatch(/do not expose|01012345678|4002/);
  });

  it.each([
    [429,"SOLAPI_RATE_LIMIT_UNKNOWN"],
    [503,"SOLAPI_SERVER_UNKNOWN"],
    [400,"SOLAPI_HTTP_UNKNOWN"],
  ] as const)("keeps ambiguous HTTP %i as unknown", async (status, code) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({statusMessage:"unsafe"}, {status}));
    await expect(client(fetchImpl).submit(input)).resolves.toEqual({
      status:"unknown",
      code,
      reconciliation:"DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps malformed 2xx, network failure, and timeout unknown without retrying", async () => {
    const scenarios: Array<[typeof fetch, string]> = [
      [vi.fn<typeof fetch>(async () => new Response("not-json", {status:200})), "SOLAPI_RESPONSE_UNKNOWN"],
      [vi.fn<typeof fetch>(async () => {throw new Error("phone and provider body");}), "SOLAPI_NETWORK_UNKNOWN"],
      [vi.fn<typeof fetch>(async () => {throw new DOMException("timed out", "TimeoutError");}), "SOLAPI_REQUEST_TIMEOUT"],
    ];
    for (const [fetchImpl, code] of scenarios) {
      const result = await client(fetchImpl).submit(input);
      expect(result).toMatchObject({status:"unknown",code});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toMatch(/phone|provider body|timed out/);
    }
  });

  it("revalidates typed input at submit and never accepts a prebuilt body", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(client(fetchImpl).submit({
      ...input,
      destination:"010-1234-5678",
      from:"01099998888",
      text:"freeform",
    } as never)).rejects.toThrowError("SOLAPI_INVALID_DESTINATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("canonical message lookup", () => {
    const destinationFingerprint = createHash("sha256").update("01012345678").digest("hex");
    const expected = {
      providerMessageId:"M4Vsafe",
      groupId:"G4Vsafe",
      deliveryKey:DELIVERY_ID,
      destinationFingerprint,
      channelId:SOLAPI_CHANNEL_ID,
      templateId:manifest.pendingRegisteredTemplateId,
    };
    function message(overrides: Record<string, unknown> = {}) {
      return {
        messageId:"M4Vsafe",
        groupId:"G4Vsafe",
        to:"+821012345678",
        country:"82",
        type:"ATA",
        status:"COMPLETE",
        statusCode:"4000",
        customFields:{deliveryKey:DELIVERY_ID},
        kakaoOptions:{pfId:SOLAPI_CHANNEL_ID,templateId:manifest.pendingRegisteredTemplateId,disableSms:true},
        replacement:false,
        replacements:[],
        reason:"must never be persisted",
        ...overrides,
      };
    }
    function lookupClient(payload: unknown) {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(payload));
      return {fetchImpl,instance:client(fetchImpl)};
    }

    it("uses the official object-keyed list query and records only COMPLETE 4000 as delivered", async () => {
      const {instance,fetchImpl} = lookupClient({messageList:{M4Vsafe:message()}});
      await expect(instance.lookup(expected)).resolves.toEqual({status:"delivered",statusCode:"4000"});
      const [rawUrl,init] = fetchImpl.mock.calls[0]!;
      const url = new URL(String(rawUrl));
      expect(`${url.origin}${url.pathname}`).toBe(SOLAPI_MESSAGE_LIST_URL);
      expect(url.searchParams.get("messageIds")).toBe(JSON.stringify([expected.providerMessageId]));
      expect(init?.method).toBe("GET");
    });

    it.each(["1010","2024","3010","3104"])("records documented correlated COMPLETE %s as terminal failure", async (statusCode) => {
      const {instance} = lookupClient({messageList:{M4Vsafe:message({statusCode})}});
      await expect(instance.lookup(expected)).resolves.toEqual({status:"failed",statusCode});
    });

    it.each(["1000","2001","3001","4001","9999"])("keeps undocumented correlated COMPLETE %s unknown", async (statusCode) => {
      const {instance} = lookupClient({messageList:{M4Vsafe:message({statusCode})}});
      await expect(instance.lookup(expected)).resolves.toEqual({status:"unknown",statusCode:null});
    });

    it.each(["PENDING","SENDING"])("keeps correlated %s as pending", async (status) => {
      const {instance} = lookupClient({messageList:{M4Vsafe:message({status,statusCode:"2000"})}});
      await expect(instance.lookup(expected)).resolves.toEqual({status:"pending",statusCode:"2000"});
    });

    it.each([
      ["array messageList", {messageList:[message()]}],
      ["missing keyed message", {messageList:{other:message()}}],
      ["message id mismatch", {messageList:{M4Vsafe:message({messageId:"other"})}}],
      ["delivery key mismatch", {messageList:{M4Vsafe:message({customFields:{deliveryKey:"other"}})}}],
      ["phone mismatch", {messageList:{M4Vsafe:message({to:"01099998888"})}}],
      ["PFID mismatch", {messageList:{M4Vsafe:message({kakaoOptions:{pfId:"other",templateId:manifest.pendingRegisteredTemplateId,disableSms:true}})}}],
      ["template mismatch", {messageList:{M4Vsafe:message({kakaoOptions:{pfId:SOLAPI_CHANNEL_ID,templateId:"other",disableSms:true}})}}],
      ["SMS fallback enabled", {messageList:{M4Vsafe:message({kakaoOptions:{pfId:SOLAPI_CHANNEL_ID,templateId:manifest.pendingRegisteredTemplateId,disableSms:false}})}}],
      ["replacement occurred", {messageList:{M4Vsafe:message({replacement:true,replacements:[{}]})}}],
      ["malformed status code", {messageList:{M4Vsafe:message({statusCode:"success"})}}],
      ["inconsistent complete receipt", {messageList:{M4Vsafe:message({statusCode:"3000"})}}],
    ])("fails closed for %s without exposing provider content", async (_name, payload) => {
      const {instance} = lookupClient(payload);
      const result = await instance.lookup(expected);
      expect(result).toEqual({status:"unknown",statusCode:null});
      expect(JSON.stringify(result)).not.toMatch(/must never|01012345678/);
    });

    it("keeps malformed JSON, HTTP errors, and timeout unknown without retry", async () => {
      const fetches = [
        vi.fn<typeof fetch>(async () => new Response("bad-json")),
        vi.fn<typeof fetch>(async () => Response.json({}, {status:503})),
        vi.fn<typeof fetch>(async () => {throw new DOMException("timeout", "TimeoutError");}),
      ];
      for (const fetchImpl of fetches) {
        await expect(client(fetchImpl).lookup(expected)).resolves.toEqual({status:"unknown",statusCode:null});
        expect(fetchImpl).toHaveBeenCalledOnce();
      }
    });
  });
});
