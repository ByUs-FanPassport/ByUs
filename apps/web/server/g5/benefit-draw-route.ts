import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { adminCorrelationId } from "./blockchain-job-route";
import {
  BenefitDrawRepositoryError,
  type BenefitDrawRepository,
} from "./benefit-draw-repository";

export interface BenefitDrawRouteDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: BenefitDrawRepository;
  now(): Date;
}
const bodySchema = z.object({ idempotencyKey: z.string().uuid() }).strict();
const json = (body: unknown, status: number) => Response.json(body, {
  status,
  headers: { "cache-control": "private, no-store", vary: "Authorization" },
});

export function createPostBenefitDrawHandler(dependencies: BenefitDrawRouteDependencies) {
  return async (request: Request, input: { campaignId: string }) => {
    const correlationId = adminCorrelationId(request);
    let admin: AdminSession;
    try {
      admin = await dependencies.authorize({
        authorization: request.headers.get("authorization") ?? "",
        correlationId,
      });
    } catch (error) {
      if (error instanceof AuthError)
        return json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
      return json({ error: { code: "BENEFIT_DRAW_UNAVAILABLE" } }, 503);
    }
    if (admin.role === "viewer") return json({ error: { code: "FORBIDDEN" } }, 403);
    const parsedId = z.string().uuid().safeParse(input.campaignId);
    let body;
    try { body = bodySchema.parse(await request.json()); }
    catch { return json({ error: { code: "INVALID_REQUEST" } }, 400); }
    if (!parsedId.success) return json({ error: { code: "CAMPAIGN_NOT_FOUND" } }, 404);
    try {
      return json(await dependencies.repository.execute({
        actor: { appUserId: admin.appUserId, allowlistId: admin.allowlistId },
        correlationId,
        campaignId: parsedId.data,
        idempotencyKey: body.idempotencyKey,
        now: dependencies.now(),
      }), 200);
    } catch (error) {
      if (error instanceof BenefitDrawRepositoryError) {
        if (error.code === "NOT_READY") return json({ error: { code: "DRAW_NOT_READY" } }, 409);
        if (error.code === "ALREADY_EXECUTED" || error.code === "CONFLICT")
          return json({ error: { code: "DRAW_ALREADY_EXECUTED" } }, 409);
      }
      return json({ error: { code: "BENEFIT_DRAW_UNAVAILABLE" } }, 503);
    }
  };
}
