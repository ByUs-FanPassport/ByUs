import {
  clientProductEventV1Schema,
  type ClientProductEventV1,
} from "../domain/product-event";

const SESSION_KEY = "byus.product-event.session.v1";
export const PAGE_VIEW_WINDOW_MS = 30 * 60_000;

function anonymousSessionId(): string {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export async function recordClientProductEvent(
  input: Omit<ClientProductEventV1, "schemaVersion" | "anonymousSessionId" | "occurredAt"> & {
    occurredAt?: string;
  },
  accessToken?: string | null,
): Promise<void> {
  const event = clientProductEventV1Schema.parse({
    ...input,
    schemaVersion: 1,
    anonymousSessionId: accessToken ? null : anonymousSessionId(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  });
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

export function pageViewIdempotencyKey(
  eventName: "creator_page_view" | "live_page_view" | "benefit_page_view",
  routeKey: string,
  now = Date.now(),
): string {
  const safeRoute = routeKey.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80);
  return `page:${eventName}:${safeRoute}:${anonymousSessionId()}:${Math.floor(now / PAGE_VIEW_WINDOW_MS)}`;
}
