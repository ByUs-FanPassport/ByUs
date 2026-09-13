import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import { homeBannerCommandSchema } from "../../features/home/domain/home-banner";
import { boundedJson, CertificationBodyError } from "../certification/certification-http";
import type { HomeBannerManagerDependencies } from "./home-banner-manager-route-dependencies";

function correlationId(request: Request) {
  const value = request.headers.get("x-correlation-id")?.trim();
  return z.string().uuid().safeParse(value).success ? value! : crypto.randomUUID();
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });
}
function failure(error: unknown) {
  if (error instanceof AuthError) return json({ error: error.code }, error.status);
  if (error instanceof CertificationBodyError) return json({ error: error.code }, error.code === "BODY_TOO_LARGE" ? 413 : 400);
  if (error instanceof SyntaxError) return json({ error: "INVALID_REQUEST" }, 400);
  if (error instanceof z.ZodError) return json({ error: "INVALID_REQUEST", issues: error.issues }, 400);
  const message = error instanceof Error ? error.message : "";
  if (/active admin required|viewer is read-only/i.test(message)) return json({ error: "FORBIDDEN" }, 403);
  if (/revision conflict/i.test(message)) return json({ error: "REVISION_CONFLICT" }, 409);
  if (/not found/i.test(message)) return json({ error: "NOT_FOUND" }, 404);
  if (/incomplete|celebrity required|duplicate key|invalid/i.test(message)) return json({ error: "INVALID_REQUEST" }, 409);
  return json({ error: "HOME_BANNER_MANAGER_UNAVAILABLE" }, 503);
}
async function authorize(request: Request, deps: HomeBannerManagerDependencies, id: string) {
  return deps.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId: id });
}
export function createHomeBannerManagerHandlers(deps: HomeBannerManagerDependencies) {
  return {
    async GET(request: Request) {
      try {
        const id = correlationId(request);
        return json(await deps.repository.read(await authorize(request, deps, id)));
      } catch (error) { return failure(error); }
    },
    async POST(request: Request) {
      try {
        const id = correlationId(request);
        const actor = await authorize(request, deps, id);
        if (actor.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
        const command = homeBannerCommandSchema.parse(await boundedJson(request, 128_000));
        await deps.repository.command(actor, id, command);
        deps.invalidatePublicContent();
        return json(await deps.repository.read(actor));
      } catch (error) { return failure(error); }
    },
  };
}
