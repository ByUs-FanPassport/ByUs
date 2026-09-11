import {
  clientProductEventV1Schema,
  type ClientProductEventV1,
} from "../domain/product-event";

const SESSION_KEY = "byus.product-event.session.v1";
const LEGACY_PAGE_VIEW_KEY_PREFIX = "byus.product-event.page-view.v1";
const LEGACY_PAGE_VIEW_PAYLOAD_CACHE_KEY = "byus.product-event.page-view-payloads.v1";
const PAGE_VIEW_CACHE_KEY = "byus.product-event.page-view-cache.v2";
const MAX_PAGE_VIEW_CACHE_ENTRIES = 64;
export const PAGE_VIEW_WINDOW_MS = 30 * 60_000;

type PageViewCacheEntry = {
  routeScope: string | null;
  idempotencyKey: string;
  ownerKind: "anonymous" | "authenticated";
  storedAt: number;
  event: ClientProductEventV1 | null;
};

function anonymousSessionId(): string {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

async function identityScope(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

function readPageViewCache(now: number): PageViewCacheEntry[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(PAGE_VIEW_CACHE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): PageViewCacheEntry[] => {
      if (!value || typeof value !== "object") return [];
      const entry = value as Record<string, unknown>;
      if (
        (entry.routeScope !== null && typeof entry.routeScope !== "string")
        || typeof entry.idempotencyKey !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$/.test(entry.idempotencyKey)
        || (entry.ownerKind !== "anonymous" && entry.ownerKind !== "authenticated")
        || typeof entry.storedAt !== "number"
        || entry.storedAt < now - PAGE_VIEW_WINDOW_MS
        || entry.storedAt > now
      ) return [];
      if (entry.event === null) return [{
        routeScope: entry.routeScope,
        idempotencyKey: entry.idempotencyKey,
        ownerKind: entry.ownerKind,
        storedAt: entry.storedAt,
        event: null,
      }];
      const event = clientProductEventV1Schema.safeParse(entry.event);
      return event.success && event.data.idempotencyKey === entry.idempotencyKey ? [{
        routeScope: entry.routeScope,
        idempotencyKey: entry.idempotencyKey,
        ownerKind: entry.ownerKind,
        storedAt: entry.storedAt,
        event: event.data,
      }] : [];
    });
  } catch {
    return [];
  }
}

function writePageViewCache(entries: PageViewCacheEntry[]): void {
  window.sessionStorage.setItem(
    PAGE_VIEW_CACHE_KEY,
    JSON.stringify(entries.slice(-MAX_PAGE_VIEW_CACHE_ENTRIES)),
  );
}

function canonicalPageViewPayload(
  event: ClientProductEventV1,
  ownerKind: PageViewCacheEntry["ownerKind"],
  now: number,
): ClientProductEventV1 {
  const entries = readPageViewCache(now);
  const existing = entries.find((entry) =>
    entry.idempotencyKey === event.idempotencyKey && entry.ownerKind === ownerKind
  );
  if (existing?.event) return existing.event;
  if (existing) existing.event = event;
  else entries.push({ routeScope: null, idempotencyKey: event.idempotencyKey, ownerKind, storedAt: now, event });
  writePageViewCache(entries);
  return event;
}

function removeLegacyPageViewCache(): void {
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key === LEGACY_PAGE_VIEW_PAYLOAD_CACHE_KEY || key?.startsWith(`${LEGACY_PAGE_VIEW_KEY_PREFIX}:`)) {
      window.sessionStorage.removeItem(key);
      index -= 1;
    }
  }
}

export async function recordClientProductEvent(
  input: Omit<ClientProductEventV1, "schemaVersion" | "anonymousSessionId" | "occurredAt"> & {
    occurredAt?: string;
  },
  accessToken?: string | null,
): Promise<void> {
  const createdAt = Date.now();
  const candidate = clientProductEventV1Schema.parse({
    ...input,
    schemaVersion: 1,
    anonymousSessionId: accessToken ? null : anonymousSessionId(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
  const event = candidate.eventName === "creator_page_view"
    || candidate.eventName === "live_page_view"
    || candidate.eventName === "benefit_page_view"
    ? canonicalPageViewPayload(candidate, accessToken ? "authenticated" : "anonymous", createdAt)
    : candidate;
  const response = await fetch("/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(event),
    keepalive: true,
  });
  if (!response.ok) throw new Error("Product event was not recorded");
}

export async function recordProductEventV1(
  input: Parameters<typeof recordClientProductEvent>[0],
  accessToken?: string | null,
): Promise<boolean> {
  if (navigator.userAgent.toLowerCase().includes("jsdom")) return true;
  try {
    await recordClientProductEvent(input, accessToken);
    return true;
  } catch {
    return false;
  }
}

export async function pageViewIdempotencyKey(
  eventName: "creator_page_view" | "live_page_view" | "benefit_page_view",
  routeKey: string,
  authenticatedOwnerId: string | null,
  now = Date.now(),
): Promise<string> {
  const safeRoute = routeKey.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80);
  const windowKey = Math.floor(now / PAGE_VIEW_WINDOW_MS);
  removeLegacyPageViewCache();
  const ownerScope = await identityScope(authenticatedOwnerId
    ? `authenticated:${authenticatedOwnerId}`
    : `anonymous:${anonymousSessionId()}`);
  const routeScope = `${eventName}:${safeRoute}:${ownerScope}:${windowKey}`;
  const entries = readPageViewCache(now);
  const existing = entries.find((entry) => entry.routeScope === routeScope);
  if (existing) {
    writePageViewCache(entries);
    return existing.idempotencyKey;
  }
  const created = `page:${eventName}:${crypto.randomUUID()}`;
  entries.push({
    routeScope,
    idempotencyKey: created,
    ownerKind: authenticatedOwnerId ? "authenticated" : "anonymous",
    storedAt: now,
    event: null,
  });
  writePageViewCache(entries);
  return created;
}
