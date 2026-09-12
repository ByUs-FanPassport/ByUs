import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { communityShareTokenSchema, communityShareLinkSchema, communityShareDestinationSchema, communityAwardResultSchema, communityCreatorSlugSchema, communityInviteSchema, communityStampCollectionSchema } from "@/features/community-stamps/domain/community-stamps";

export interface CommunityStampDependencies {
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
export function communityStampFailure(error: unknown) {
  if (error instanceof AuthError) return json({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "COMMUNITY_STAMP_INVALID_REQUEST" } }, 400);
  const code = error instanceof Error ? error.message : "";
  const status = ({ COMMUNITY_STAMP_NOT_FOUND: 404, COMMUNITY_STAMP_WALLET_NOT_READY: 409, COMMUNITY_STAMP_INVALID_REQUEST: 400, COMMUNITY_STAMP_SELF_INVITE: 400, COMMUNITY_STAMP_SELF_SHARE: 400, COMMUNITY_STAMP_PASSPORT_REQUIRED: 409, COMMUNITY_STAMP_ALREADY_REDEEMED: 409, COMMUNITY_STAMP_RATE_LIMITED: 429 } as Record<string, number>)[code];
  return json({ error: { code: status ? code : "COMMUNITY_STAMP_UNAVAILABLE" } }, status ?? 503);
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new Error("COMMUNITY_STAMP_INVALID_REQUEST"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("COMMUNITY_STAMP_UNAVAILABLE");
  return result.data;
}
export function createCommunityStampHandlers(deps: CommunityStampDependencies) {
  return {
    async collection(request: Request) {
      try {
        const { appUserId } = await deps.authorize(request.headers.get("authorization"));
        const query = new URL(request.url).searchParams;
        if (query.getAll("creator").length > 1) throw new Error("COMMUNITY_STAMP_INVALID_REQUEST");
        const creator = communityCreatorSlugSchema.nullable().parse(query.get("creator"));
        const data = await deps.rpc("get_owned_community_stamps", { p_app_user_id: appUserId, p_celebrity_slug: creator });
        return json(parseResponse(communityStampCollectionSchema, data));
      } catch (error) { return communityStampFailure(error); }
    },
    async action(request: Request, action: string) {
      try {
        const { appUserId } = await deps.authorize(request.headers.get("authorization"));
        const raw = await readBody(request);
        let result: unknown;
        if (action === "welcome") {
          z.object({}).strict().parse(raw);
          result = await deps.rpc("claim_welcome_community_stamp", { p_app_user_id: appUserId });
        } else if (action === "check-in") {
          const input = z.object({ creator: communityCreatorSlugSchema }).strict().parse(raw);
          result = await deps.rpc("check_in_community_stamp", { p_app_user_id: appUserId, p_celebrity_slug: input.creator });
        } else if (action === "share-link") {
          const input = z.object({ creator: communityCreatorSlugSchema }).strict().parse(raw);
          return json(parseResponse(communityShareLinkSchema, await deps.rpc("create_community_stamp_share_link", { p_app_user_id: appUserId, p_celebrity_slug: input.creator })));
        } else if (action === "share-visit") {
          const input = z.object({ token: communityShareTokenSchema }).strict().parse(raw);
          return json(parseResponse(communityShareDestinationSchema, await deps.rpc("visit_community_stamp_share_link", { p_app_user_id: appUserId, p_token: input.token })));
        } else if (action === "invite-code") {
          z.object({}).strict().parse(raw);
          return json(parseResponse(communityInviteSchema, await deps.rpc("get_community_stamp_invite_code", { p_app_user_id: appUserId })));
        } else if (action === "redeem-invite") {
          const input = z.object({ code: z.string().trim().min(6).max(32).regex(/^[a-zA-Z0-9-]+$/) }).strict().parse(raw);
          result = await deps.rpc("redeem_community_stamp_invite", { p_app_user_id: appUserId, p_code: input.code.toUpperCase() });
        } else return json({ error: { code: "COMMUNITY_STAMP_NOT_FOUND" } }, 404);
        return json(parseResponse(communityAwardResultSchema, result));
      } catch (error) { return communityStampFailure(error); }
    },
  };
}
