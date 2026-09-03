import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  assertSafeProductEventTime,
  clientProductEventV1Schema,
} from "../../features/analytics/domain/product-event";
import {
  ProductEventRepositoryError,
  type ProductEventRepository,
} from "./product-event-repository";

export type ProductEventRouteDependencies = {
  identify(authorization: string | null): Promise<{ appUserId: string } | null>;
  repository: ProductEventRepository;
  now(): Date;
};

const headers = { "cache-control": "no-store", vary: "Authorization" } as const;
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export function createRecordProductEventHandler(dependencies: ProductEventRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 8_192) return json({ error: { code: "EVENT_INVALID" } }, 413);

    try {
      const raw = await request.json();
      const input = clientProductEventV1Schema.parse(raw);
      assertSafeProductEventTime(input.occurredAt, dependencies.now());
      const owner = await dependencies.identify(request.headers.get("authorization"));
      if (!owner && !input.anonymousSessionId) return json({ error: { code: "EVENT_OWNER_REQUIRED" } }, 400);
      const result = await dependencies.repository.record({
        ...input,
        appUserId: owner?.appUserId ?? null,
        anonymousSessionId: owner ? null : input.anonymousSessionId,
      });
      return json({ event: result }, result.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      if (error instanceof ProductEventRepositoryError) {
        return json({ error: { code: error.code } }, error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 503);
      }
      return json({ error: { code: "EVENT_INVALID" } }, 400);
    }
  };
}
