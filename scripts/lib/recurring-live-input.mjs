import { createHash } from "node:crypto";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = /^\d{4}-\d{2}-\d{2}$/;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function keys(value, allowed, context) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), `Invalid ${context}`);
  requireValue(Object.keys(value).every(key => allowed.includes(key)), `Unexpected ${context} field`);
}
function validDate(value) { return typeof value === "string" && date.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function instant(value) { return typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)); }
export function validateSourceUrl(value, provider) {
  const parsed = new URL(value);
  requireValue(parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && !parsed.hash, "Unsafe source URL");
  const host = parsed.hostname.replace(/^www\./, "");
  const hosts = { tiktok: ["tiktok.com"], instagram: ["instagram.com"], youtube: ["youtube.com", "youtu.be"], chzzk: ["chzzk.naver.com"] };
  requireValue((provider ? hosts[provider] ?? [] : Object.values(hosts).flat()).includes(host), "Unexpected source host");
  requireValue(parsed.pathname !== "/", "Source account path required");
  return value;
}
export function validateRecurringRule(rule) {
  keys(rule, ["timeZone", "effectiveFrom", "effectiveUntil", "provider", "channelUrl", "slots"], "rule");
  requireValue(typeof rule.timeZone === "string" && (rule.timeZone.includes("/") || rule.timeZone === "UTC"), "IANA timezone required");
  new Intl.DateTimeFormat("en", { timeZone: rule.timeZone }).format();
  requireValue(validDate(rule.effectiveFrom) && (rule.effectiveUntil === null || validDate(rule.effectiveUntil) && rule.effectiveUntil >= rule.effectiveFrom), "Invalid rule date");
  requireValue(["tiktok", "instagram", "youtube", "chzzk"].includes(rule.provider), "Invalid provider");
  validateSourceUrl(rule.channelUrl, rule.provider);
  const channel = new URL(rule.channelUrl);
  if (rule.provider === "chzzk") requireValue(/^\/(?:live\/)?[a-f0-9]{32}\/?$/.test(channel.pathname) && !channel.search, "Invalid CHZZK channel");
  requireValue(Array.isArray(rule.slots) && rule.slots.length > 0 && rule.slots.length <= 14, "Invalid slots");
  const ids = new Set(); const starts = new Set();
  for (const slot of rule.slots) {
    keys(slot, ["id", "isoWeekday", "localStartTime", "end"], "slot");
    requireValue(uuid.test(slot.id) && !ids.has(slot.id), "Invalid or duplicate slot ID"); ids.add(slot.id);
    requireValue(Number.isInteger(slot.isoWeekday) && slot.isoWeekday >= 1 && slot.isoWeekday <= 7 && time.test(slot.localStartTime), "Invalid slot time");
    const start = `${slot.isoWeekday}/${slot.localStartTime}`;
    requireValue(!starts.has(start), "Duplicate slot time"); starts.add(start);
    if (slot.end !== null) {
      keys(slot.end, ["localTime", "dayOffset"], "slot end");
      requireValue(time.test(slot.end.localTime) && Number.isInteger(slot.end.dayOffset) && slot.end.dayOffset >= 0 && slot.end.dayOffset <= 1, "Invalid slot end");
      requireValue(slot.end.dayOffset > 0 || slot.end.localTime > slot.localStartTime, "End must follow start");
    }
  }
  return rule;
}
export function validateRecurringInput(input) {
  keys(input, ["version", "runId", "rosterObservedAt", "creators"], "input");
  requireValue(input.version === 1 && uuid.test(input.runId) && instant(input.rosterObservedAt), "Invalid input version/run/date");
  requireValue(Array.isArray(input.creators) && input.creators.length > 0 && input.creators.length <= 500, "Invalid creator count");
  const ids = new Set();
  for (const creator of input.creators) {
    keys(creator, ["celebrityId", "result", "verification", "observations", "seriesKey", "proposedRule", "expectedCurrentRevisionId"], "creator");
    requireValue(uuid.test(creator.celebrityId) && !ids.has(creator.celebrityId), "Invalid or duplicate creator"); ids.add(creator.celebrityId);
    requireValue(["regular", "irregular", "unconfirmed"].includes(creator.result) && ["verified", "inaccessible", "not_found", "conflicting"].includes(creator.verification), "Invalid observation status");
    requireValue(Array.isArray(creator.observations) && creator.observations.length > 0 && creator.observations.length <= 20, "Invalid observations");
    for (const observation of creator.observations) {
      keys(observation, ["sourceUrl", "sourceAccount", "sourcePublishedAt", "observedAt", "originalText", "evidencePath", "contentHash"], "observation");
      if (observation.sourceUrl !== null) validateSourceUrl(observation.sourceUrl);
      requireValue(instant(observation.observedAt) && (observation.sourcePublishedAt === null || instant(observation.sourcePublishedAt)), "Invalid observation date");
      requireValue(observation.originalText === null || typeof observation.originalText === "string" && observation.originalText.length <= 8000, "Invalid observation text");
      requireValue(typeof observation.contentHash === "string" && /^[a-f0-9]{64}$/.test(observation.contentHash), "Invalid evidence hash");
      for (const key of ["sourceAccount", "evidencePath"]) requireValue(observation[key] === null || typeof observation[key] === "string" && observation[key].length <= 2000, `Invalid ${key}`);
    }
    requireValue(creator.expectedCurrentRevisionId === null || uuid.test(creator.expectedCurrentRevisionId), "Invalid expected revision");
    requireValue(creator.seriesKey === null || typeof creator.seriesKey === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(creator.seriesKey), "Invalid series key");
    if (creator.proposedRule !== null) {
      requireValue(creator.result === "regular" && creator.verification === "verified" && creator.seriesKey !== null, "Only verified regular sources can propose rules");
      validateRecurringRule(creator.proposedRule);
    }
  }
  return input;
}
export function evidenceHash(text) { return createHash("sha256").update(text).digest("hex"); }
export function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
