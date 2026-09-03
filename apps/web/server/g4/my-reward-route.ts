import "server-only";

import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import type { MyRewardRepository } from "./my-reward-repository";

export interface MyRewardRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: MyRewardRepository;
}

const headers = { "cache-control": "no-store", vary: "Authorization" } as const;

function error(status: 401 | 403 | 503, code: string): Response {
  return Response.json({ error: { code } }, { status, headers });
}

export function createMyRewardsHandler(
  dependencies: MyRewardRouteDependencies,
) {
  return async (request: Request): Promise<Response> => {
    let owner: AuthorizedFan;
    try {
      owner = await dependencies.authorize(
        request.headers.get("authorization") ?? "",
      );
    } catch (caught) {
      if (caught instanceof AuthError)
        return caught.status === 401
          ? error(401, "UNAUTHENTICATED")
          : error(403, "FORBIDDEN");
      return error(503, "REWARDS_UNAVAILABLE");
    }
    try {
      return Response.json(
        { rewards: await dependencies.repository.list({ appUserId: owner.appUserId }) },
        { headers },
      );
    } catch {
      return error(503, "REWARDS_UNAVAILABLE");
    }
  };
}
