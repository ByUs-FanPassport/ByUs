import { createHash, createHmac, randomBytes } from "node:crypto";
import { buildSolapiRequest } from "./template-builder.js";
import { SOLAPI_APPROVED_TEMPLATES } from "./template-manifest.js";
import type {
  SolapiApprovalRecord,
  SolapiCorrelation,
  SolapiLookupResult,
  SolapiPreparedRequest,
  SolapiSubmitInput,
  SolapiSubmitResult,
} from "./types.js";

export const SOLAPI_SEND_MANY_DETAIL_URL = "https://api.solapi.com/messages/v4/send-many/detail";
export const SOLAPI_MESSAGE_GROUPS_URL = "https://api.solapi.com/messages/v4/groups";
export const SOLAPI_REQUEST_TIMEOUT_MS = 8_000;
const RECONCILIATION = "DO_NOT_RESEND_OR_FALL_BACK_PENDING_MANUAL_RECONCILIATION" as const;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{2,128}$/;
// SOLAPI's published message-status error codes. A syntactically valid but
// undocumented code is not proof of terminal failure and stays unknown.
const SOLAPI_TERMINAL_FAILURE_STATUS_CODES = new Set([
  "1010", "1011", "1013", "1014", "1020", "1021", "1022", "1023", "1024", "1025",
  "1026", "1027", "1028", "1029", "1030", "1031", "1032", "1033", "1034", "1035",
  "1036", "1037", "1039", "1040", "1041", "1042", "1043", "1044", "1045", "1046",
  "1047", "1048", "1049", "1050", "1052", "1053", "1054", "1055", "1056", "1057",
  "1058", "1059", "1060", "1061", "1062", "1064", "1065", "1070", "1157", "1158",
  "1159", "2011", "2012", "2024", "2025", "2061", "2062", "2064", "2065", "2230",
  "2254", "3010", "3011", "3012", "3013", "3014", "3024", "3031", "3032", "3040",
  "3041", "3042", "3043", "3044", "3045", "3046", "3047", "3048", "3050", "3051",
  "3052", "3053", "3054", "3055", "3056", "3057", "3058", "3059", "3060", "3061",
  "3062", "3063", "3101", "3102", "3103", "3104", "3105", "3106", "3107", "3108",
  "3109", "3110", "3111", "3112", "3113", "3114", "3115", "3116", "3117", "3118",
]);

type Fetch = typeof fetch;

export interface SolapiClientOptions {
  apiKey: string;
  apiSecret: string;
  approvals?: readonly SolapiApprovalRecord[];
  fetch?: Fetch;
  now?: () => Date;
  salt?: () => string;
}

function unknown(code: Extract<SolapiSubmitResult, {status:"unknown"}>["code"]): SolapiSubmitResult {
  return {status:"unknown",code,reconciliation:RECONCILIATION};
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
}

function safeObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function correlatedDeliveryKey(value: unknown, deliveryKey: string): boolean {
  return safeObject(safeObject(value)?.customFields)?.deliveryKey === deliveryKey;
}

function normalizeDomesticPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (/^010\d{8}$/.test(value)) return value;
  if (/^(?:\+?82)10\d{8}$/.test(value)) return `0${value.replace(/^\+?82/, "")}`;
  return undefined;
}

function classifyLookup(payload: unknown, expected: SolapiCorrelation): SolapiLookupResult {
  const root = safeObject(payload);
  const messageList = safeObject(root?.messageList);
  if (!messageList || Object.keys(messageList).length !== 1 || !Object.hasOwn(messageList, expected.providerMessageId)) {
    return {status:"unknown",statusCode:null};
  }
  const message = safeObject(messageList[expected.providerMessageId]);
  const kakao = safeObject(message?.kakaoOptions);
  const replacements = message?.replacements;
  const domestic = normalizeDomesticPhone(message?.to);
  const correlated =
    message?.messageId === expected.providerMessageId &&
    message?.groupId === expected.groupId &&
    message?.type === "ATA" &&
    message?.country === "82" &&
    correlatedDeliveryKey(message, expected.deliveryKey) &&
    domestic !== undefined &&
    createHash("sha256").update(domestic).digest("hex") === expected.destinationFingerprint &&
    kakao?.pfId === expected.channelId &&
    kakao?.templateId === expected.templateId &&
    kakao?.disableSms === true &&
    message?.replacement === false &&
    Array.isArray(replacements) && replacements.length === 0;
  if (!correlated) return {status:"unknown",statusCode:null};

  const status = message.status;
  const statusCode = message.statusCode;
  if (status === "COMPLETE") {
    if (statusCode === "4000") return {status:"delivered",statusCode:"4000"};
    if (statusCode === "2000" || statusCode === "3000") return {status:"unknown",statusCode:null};
    if (typeof statusCode === "string" && SOLAPI_TERMINAL_FAILURE_STATUS_CODES.has(statusCode)) {
      return {status:"failed",statusCode};
    }
    return {status:"unknown",statusCode:null};
  }
  if (
    (status === "PENDING" || status === "SENDING") &&
    (statusCode === null || statusCode === "2000" || statusCode === "3000")
  ) return {status:"pending",statusCode};
  return {status:"unknown",statusCode:null};
}

function classifyResponse(status: number, payload: unknown, deliveryKey: string): SolapiSubmitResult {
  if (status === 429) return unknown("SOLAPI_RATE_LIMIT_UNKNOWN");
  if (status >= 500) return unknown("SOLAPI_SERVER_UNKNOWN");
  const root = safeObject(payload);
  const group = safeObject(root?.groupInfo);
  const count = safeObject(group?.count);
  const failed = Array.isArray(root?.failedMessageList) ? root.failedMessageList : undefined;
  const messages = Array.isArray(root?.messageList) ? root.messageList : undefined;
  const groupId = group?.groupId;

  const accepted =
    status >= 200 && status < 300 &&
    count?.total === 1 && count.registeredSuccess === 1 && count.registeredFailed === 0 &&
    failed?.length === 0 && messages?.length === 1 &&
    safeObject(messages[0])?.statusCode === "2000" &&
    correlatedDeliveryKey(messages[0], deliveryKey) &&
    typeof safeObject(messages[0])?.messageId === "string" &&
    SAFE_PROVIDER_ID.test(safeObject(messages[0])!.messageId as string) &&
    typeof groupId === "string" && SAFE_PROVIDER_ID.test(groupId);
  if (accepted) {
    return {
      status:"accepted",
      receipt:{
        providerMessageId:safeObject(messages![0])!.messageId as string,
        groupId:groupId as string,
      },
    };
  }

  const failedItem = failed?.length === 1 ? safeObject(failed[0]) : undefined;
  const clearlyRejected =
    status >= 200 && status < 500 &&
    count?.total === 1 && count.registeredSuccess === 0 && count.registeredFailed === 1 &&
    failedItem !== undefined &&
    typeof failedItem.statusCode === "string" && failedItem.statusCode.length > 0 && failedItem.statusCode !== "2000" &&
    correlatedDeliveryKey(failedItem, deliveryKey) &&
    (!messages || messages.length === 0);
  if (clearlyRejected) return {status:"rejected",code:"SOLAPI_PROVIDER_REJECTED"};
  return unknown(status >= 400 ? "SOLAPI_HTTP_UNKNOWN" : "SOLAPI_RESPONSE_UNKNOWN");
}

/**
 * Provider transport only. Cross-request safety belongs to the dedicated
 * delivery ledger: callers must win begin before using submitPrepared and must
 * persist accepted or unknown outcomes without retry or channel fallback.
 */
export class SolapiClient {
  private readonly fetchImpl: Fetch;
  private readonly approvals: readonly SolapiApprovalRecord[];
  private readonly now: () => Date;
  private readonly salt: () => string;

  constructor(private readonly options: SolapiClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.approvals = options.approvals ?? SOLAPI_APPROVED_TEMPLATES;
    this.now = options.now ?? (() => new Date());
    this.salt = options.salt ?? (() => randomBytes(16).toString("hex"));
  }

  private authorization(): string | undefined {
    if (!validApiKey(this.options.apiKey) || !validSecret(this.options.apiSecret)) return undefined;
    const date = this.now().toISOString();
    const salt = this.salt();
    if (!/^[0-9a-f]{32}$/.test(salt)) return undefined;
    const signature = createHmac("sha256", this.options.apiSecret).update(date + salt).digest("hex");
    return `HMAC-SHA256 apiKey=${this.options.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }

  async submit(input: SolapiSubmitInput): Promise<SolapiSubmitResult> {
    // Validation happens for every submission, including values cast around TS.
    const body = buildSolapiRequest(input, this.approvals);
    return this.submitPrepared(body, input.id);
  }

  async submitPrepared(body: SolapiPreparedRequest, deliveryKey: string): Promise<SolapiSubmitResult> {
    if (body.messages[0].customFields.deliveryKey !== deliveryKey) {
      return unknown("SOLAPI_RESPONSE_UNKNOWN");
    }
    const authorization = this.authorization();
    if (!authorization) {
      return unknown("SOLAPI_INVALID_CONFIGURATION");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(SOLAPI_SEND_MANY_DETAIL_URL, {
        method:"POST",
        headers:{Authorization:authorization,"Content-Type":"application/json"},
        body:JSON.stringify(body),
        redirect:"error",
        signal:AbortSignal.timeout(SOLAPI_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      return unknown(error instanceof DOMException && error.name === "TimeoutError"
        ? "SOLAPI_REQUEST_TIMEOUT"
        : "SOLAPI_NETWORK_UNKNOWN");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unknown(response.status >= 500
        ? "SOLAPI_SERVER_UNKNOWN"
        : response.status === 429
          ? "SOLAPI_RATE_LIMIT_UNKNOWN"
          : response.status >= 400
            ? "SOLAPI_HTTP_UNKNOWN"
            : "SOLAPI_RESPONSE_UNKNOWN");
    }
    return classifyResponse(response.status, payload, deliveryKey);
  }

  async lookup(expected: SolapiCorrelation): Promise<SolapiLookupResult> {
    const authorization = this.authorization();
    if (!authorization || !SAFE_PROVIDER_ID.test(expected.providerMessageId) || !SAFE_PROVIDER_ID.test(expected.groupId)) {
      return {status:"unknown",statusCode:null};
    }
    // Every submitted group contains one message. The acknowledged group lookup
    // exposes its canonical result even when the global list has not indexed it.
    const url = new URL(`${SOLAPI_MESSAGE_GROUPS_URL}/${encodeURIComponent(expected.groupId)}/messages`);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method:"GET",
        headers:{Authorization:authorization},
        redirect:"error",
        signal:AbortSignal.timeout(SOLAPI_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return {status:"unknown",statusCode:null};
    }
    if (response.status < 200 || response.status >= 300) {
      return {status:"unknown",statusCode:null};
    }
    try {
      return classifyLookup(await response.json(), expected);
    } catch {
      return {status:"unknown",statusCode:null};
    }
  }
}
