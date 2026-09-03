import "server-only";
import { recipientInputSchema } from "../../features/benefit/domain/fulfillment";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import type { BenefitFulfillmentRepository } from "./benefit-fulfillment-repository";

export interface BenefitFulfillmentRouteDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: BenefitFulfillmentRepository;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
export function createPostOwnedBenefitRecipientHandler(dependencies: BenefitFulfillmentRouteDependencies) {
  return async (request: Request, input: { winnerId: string }) => {
    if (!uuid.test(input.winnerId)) return json({ error: { code: "REWARD_NOT_FOUND" } }, 404);
    let recipient;
    try { recipient = recipientInputSchema.parse(await request.json()); }
    catch { return json({ error: { code: "INVALID_REQUEST" } }, 400); }
    let owner;
    try { owner = await dependencies.authorize(request.headers.get("authorization")); }
    catch (error) {
      if (error instanceof FanAuthUnavailableError) return json({ error: { code: "REWARD_UNAVAILABLE" } }, 503);
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    try {
      return json(await dependencies.repository.saveRecipient({ appUserId: owner.appUserId, winnerId: input.winnerId, correlationId: crypto.randomUUID(), recipient }), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/NOT_FOUND/.test(message)) return json({ error: { code: "REWARD_NOT_FOUND" } }, 404);
      if (/CONSENT|ADDRESS|INVALID|STATE_CONFLICT|NOT_REQUIRED/.test(message)) return json({ error: { code: "RECIPIENT_REJECTED" } }, 409);
      return json({ error: { code: "REWARD_UNAVAILABLE" } }, 503);
    }
  };
}
