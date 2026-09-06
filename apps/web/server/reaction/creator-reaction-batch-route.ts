import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import { parseCreatorSlugList } from "../../features/reaction/domain/creator-reaction-batch";
import { FanAuthUnavailableError } from "../fan-auth/fan-auth-gate";
import type { CreatorReactionBatchRepository } from "./creator-reaction-batch-repository";

export type CreatorReactionBatchRouteDependencies = {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  repository: CreatorReactionBatchRepository;
};

const headers = { "cache-control": "private, no-store", vary: "Authorization" } as const;
const json = (body: unknown, status: number) => Response.json(body, { status, headers });

export function createGetCreatorReactionsHandler(dependencies: CreatorReactionBatchRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const slugs = parseCreatorSlugList(new URL(request.url));
    if (!slugs) return json({ error: { code: "INVALID_REQUEST" } }, 400);
    let owner: { appUserId: string };
    try {
      owner = await dependencies.authorize(request.headers.get("authorization"));
    } catch (error) {
      if (error instanceof FanAuthUnavailableError) return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503);
      if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
      return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    try {
      const reactions = await dependencies.repository.findMany({ appUserId: owner.appUserId, celebritySlugs: slugs });
      return json({ states: Object.fromEntries(reactions.map(({ slug, reacted }) => [slug, { reacted }])) }, 200);
    } catch {
      return json({ error: { code: "REACTION_UNAVAILABLE" } }, 503);
    }
  };
}
