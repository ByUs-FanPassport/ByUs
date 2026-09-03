import {
  clientProductEventV1Schema,
  type ClientProductEventV1,
} from "../domain/product-event";

const SESSION_KEY = "byus.product-event.session.v1";

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
