import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import { ReactionRepositoryError, type ReactionRepository } from "./reaction-repository";

export type ReactionRouteDependencies = {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: ReactionRepository;
};

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "private, no-store", vary: "Authorization" } });

export function createPostReactionHandler(deps: ReactionRouteDependencies) {
  return async (request: Request, input: { celebritySlug: string }): Promise<Response> => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.celebritySlug)) return json({ error: { code: "CREATOR_NOT_FOUND" } }, 404);
    let owner;
    try { owner = await deps.authorize(request.headers.get("authorization")); }
    catch (error) {
      if (error instanceof FanAuthUnavailableError) return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503);
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    try { return json(await deps.repository.react({ appUserId: owner.appUserId, celebritySlug: input.celebritySlug }), 200); }
    catch (error) {
      if (error instanceof ReactionRepositoryError) {
        const status = error.code === "CREATOR_NOT_FOUND" ? 404 : error.code === "WALLET_NOT_READY" ? 409 : error.code === "USER_UNAVAILABLE" ? 403 : 503;
        return json({ error: { code: error.code } }, status);
      }
      return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503);
    }
  };
}

export function createGetReactionHandler(deps: ReactionRouteDependencies) {
  return async (request: Request, input: { celebritySlug: string }): Promise<Response> => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.celebritySlug)) return json({ error: { code: "CREATOR_NOT_FOUND" } }, 404);
    let owner;
    try { owner = await deps.authorize(request.headers.get("authorization")); }
    catch (error) {
      if (error instanceof FanAuthUnavailableError) return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503);
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    try { return json({ reaction: await deps.repository.find({ appUserId: owner.appUserId, celebritySlug: input.celebritySlug }) }, 200); }
    catch { return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503); }
  };
}
