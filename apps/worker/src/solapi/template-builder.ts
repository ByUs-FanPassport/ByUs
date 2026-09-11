import {
  SOLAPI_APPROVED_TEMPLATES,
  SOLAPI_CHANNEL_ID,
  SOLAPI_PENDING_TEMPLATES,
  type SolapiPendingTemplate,
} from "./template-manifest.js";
import type {
  SolapiApprovalRecord,
  SolapiPreparedRequest,
  SolapiSubmitInput,
} from "./types.js";
import { SolapiValidationError } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,99})$/;
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const VERIFIED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function fail(code: string): never {
  throw new SolapiValidationError(code);
}

function validateOpaqueUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("SOLAPI_INVALID_DELIVERY_KEY");
  return value;
}

function validateText(value: unknown, field: "artist" | "title", max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value) ||
    value.includes("#{")
  ) fail(`SOLAPI_INVALID_${field.toUpperCase()}`);
  return value;
}

function validateDestination(value: unknown): string {
  if (typeof value !== "string" || !/^010\d{8}$/.test(value)) {
    fail("SOLAPI_INVALID_DESTINATION");
  }
  return value;
}

function validateIsoDate(value: unknown): string {
  if (typeof value !== "string") fail("SOLAPI_INVALID_STARTS_AT");
  const match = ISO_WITH_ZONE.exec(value);
  if (!match) fail("SOLAPI_INVALID_STARTS_AT");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    fail("SOLAPI_INVALID_STARTS_AT");
  }
  if (zone !== "Z") {
    const offsetHour = Number(zone!.slice(1, 3));
    const offsetMinute = Number(zone!.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      fail("SOLAPI_INVALID_STARTS_AT");
    }
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) fail("SOLAPI_INVALID_STARTS_AT");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function parseDeepLink(value: unknown, target: "live" | "benefit"): string {
  if (
    typeof value !== "string" ||
    value.length > 300 ||
    /[\u0000-\u001f\u007f-\u009f\\]/.test(value) ||
    value.includes("#") ||
    value.includes("%") ||
    /(?:^|\/)\.{1,2}(?:\/|\?|$)/.test(value)
  ) {
    fail("SOLAPI_INVALID_DEEP_LINK");
  }
  const absolute = value.startsWith("https://");
  if (!absolute && (!value.startsWith("/") || value.startsWith("//"))) fail("SOLAPI_INVALID_DEEP_LINK");
  if (absolute && !value.startsWith("https://byus.kr/")) fail("SOLAPI_INVALID_DEEP_LINK");
  let parsed: URL;
  try {
    parsed = new URL(value, "https://byus.kr");
  } catch {
    fail("SOLAPI_INVALID_DEEP_LINK");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "byus.kr" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "?locale=ko" ||
    parsed.hash !== "" ||
    parsed.pathname.includes("%") ||
    parsed.pathname.includes(".")
  ) fail("SOLAPI_INVALID_DEEP_LINK");
  const pattern = target === "live" ? /^\/live\/([^/]+)$/ : /^\/benefits\/([^/]+)$/;
  const route = pattern.exec(parsed.pathname);
  if (!route?.[1]) fail("SOLAPI_INVALID_DEEP_LINK");
  const routeValue = route[1];
  if (target === "live" ? !LIVE_SLUG.test(routeValue) : !UUID.test(routeValue)) {
    fail("SOLAPI_INVALID_DEEP_LINK");
  }
  return routeValue;
}

function selectManifest(input: SolapiSubmitInput): SolapiPendingTemplate {
  const status = input.templateKey === "fulfillment_meaningful_update"
    ? input.context.fulfillmentStatus
    : undefined;
  const manifest = (SOLAPI_PENDING_TEMPLATES as readonly SolapiPendingTemplate[]).find(
    (entry) => entry.templateKey === input.templateKey && entry.fulfillmentStatus === status,
  );
  if (!manifest) fail("SOLAPI_TEMPLATE_NOT_SUPPORTED");
  return manifest;
}

function selectApproval(
  manifest: SolapiPendingTemplate,
  approvals: readonly SolapiApprovalRecord[],
): SolapiApprovalRecord {
  const matches = approvals.filter(
    (record) =>
      record.templateKey === manifest.templateKey &&
      record.locale === "ko" &&
      record.channelId === SOLAPI_CHANNEL_ID &&
      record.registeredTemplateId === manifest.pendingRegisteredTemplateId &&
      record.fulfillmentStatus === manifest.fulfillmentStatus &&
      VERIFIED_AT.test(record.verifiedAt) &&
      Number.isFinite(Date.parse(record.verifiedAt)),
  );
  if (matches.length !== 1) fail("SOLAPI_TEMPLATE_NOT_APPROVED");
  return matches[0]!;
}

export function buildSolapiRequest(
  input: SolapiSubmitInput,
  approvals: readonly SolapiApprovalRecord[] = SOLAPI_APPROVED_TEMPLATES,
): SolapiPreparedRequest {
  if (input.channel !== "kakao" || input.locale !== "ko") fail("SOLAPI_UNSUPPORTED_CHANNEL_OR_LOCALE");
  const deliveryKey = validateOpaqueUuid(input.id);
  const to = validateDestination(input.destination);
  const artist = validateText(input.context?.artist, "artist", 80);
  const title = validateText(input.context?.title, "title", 160);
  const manifest = selectManifest(input);
  const approval = selectApproval(manifest, approvals);
  const liveTarget = input.templateKey.startsWith("live_");
  const routeVariable = parseDeepLink(input.deepLink, liveTarget ? "live" : "benefit");
  const variables: Record<string, string> = {
    "#{artist}": artist,
    "#{title}": title,
  };
  if (input.templateKey !== "live_cancelled" && liveTarget) {
    variables["#{startsAt}"] = validateIsoDate(input.startsAt);
  }
  variables[liveTarget ? "#{liveSlug}" : "#{benefitId}"] = routeVariable;
  if (
    Object.keys(variables).length !== manifest.variables.length ||
    !manifest.variables.every((key) => Object.hasOwn(variables, key))
  ) fail("SOLAPI_VARIABLE_MISMATCH");

  return {
    messages: [{
      type: "ATA",
      country: "82",
      to,
      kakaoOptions: {
        pfId: approval.channelId,
        templateId: approval.registeredTemplateId,
        variables,
        disableSms: true,
      },
      customFields: {deliveryKey},
    }],
    strict: true,
    allowDuplicates: false,
    showMessageList: true,
  };
}
