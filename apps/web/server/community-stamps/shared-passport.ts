import "server-only";
import { communityShareDestinationSchema, communityShareTokenSchema } from "@/features/community-stamps/domain/community-stamps";
import type { CommunityStampDependencies } from "./routes";

// The anonymous read only exposes a published creator. It never records a visit.
export async function resolveSharedPassport(token: string, deps: Pick<CommunityStampDependencies, "rpc">) {
  if (!communityShareTokenSchema.safeParse(token).success) return null;
  try {
    const result = await deps.rpc("resolve_community_stamp_share_link", { p_token: token });
    return communityShareDestinationSchema.parse(result);
  } catch (error) {
    if (error instanceof Error && error.message === "COMMUNITY_STAMP_NOT_FOUND") return null;
    throw new Error("Shared Passport is unavailable");
  }
}
