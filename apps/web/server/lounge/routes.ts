import "server-only";

import { z } from "zod";
import {
  loungeMessageSchema,
  postLoungeMessageSchema,
  setLoungeReactionSchema,
} from "../../features/lounge/domain/lounge";
import { celebritySlugSchema } from "../../features/fanpage/domain/community";
import type { FanpageDependencies } from "../fanpage/routes";
import { fanpageFailure, fanpageJson } from "../fanpage/routes";

export type LoungeDependencies = FanpageDependencies;

const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
const loungeRpcSchema = z.object({
  likeCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  messages: z.array(loungeMessageSchema).max(200),
}).strict();
const postResultSchema = z.object({ id: z.uuid(), replayed: z.boolean() }).strict();
const adminMessageSchema = z.object({
  id: z.uuid(),
  body: z.string().min(1).max(1000),
  nickname: z.string().min(1).max(80),
  celebritySlug: celebritySlugSchema,
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
const adminRpcSchema = z.object({ messages: z.array(adminMessageSchema).max(50) }).strict();

function parseResult<T>(schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("FANPAGE_INVALID_RESPONSE");
  return parsed.data;
}

function parseLocale(url: URL): "ko" | "en" {
  const values = url.searchParams.getAll("locale");
  if (values.length > 1) throw new Error("FANPAGE_INVALID_REQUEST");
  return z.enum(["ko", "en"]).parse(values[0] ?? "ko");
}

function parseCursor(raw: string | null) {
  if (raw === null) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(z.string().max(240).parse(raw), "base64url").toString("utf8")));
  } catch {
    throw new Error("FANPAGE_INVALID_REQUEST");
  }
}

function encodeCursor(row: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ at: row.createdAt, id: row.id })).toString("base64url");
}

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("FANPAGE_INVALID_REQUEST");
  return values[0] ?? null;
}

function parseIds(url: URL): string[] | null {
  const raw = singleParam(url, "ids");
  if (raw === null) return null;
  const ids = raw.split(",");
  if (ids.length < 1 || ids.length > 200 || ids.some((id) => !z.uuid().safeParse(id).success)) {
    throw new Error("FANPAGE_INVALID_REQUEST");
  }
  return ids;
}

async function optionalOwner(request: Request, dependencies: LoungeDependencies) {
  const authorization = request.headers.get("authorization");
  return authorization === null ? null : (await dependencies.authorize(authorization)).appUserId;
}

async function readSmallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new Error("FANPAGE_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export function createLoungeHandlers(dependencies: LoungeDependencies) {
  return {
    async read(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const owner = await optionalOwner(request, dependencies);
        const url = new URL(request.url);
        const contentLocale = parseLocale(url);
        const ids = parseIds(url);
        const cursorRaw = singleParam(url, "cursor");
        if (ids && cursorRaw !== null) throw new Error("FANPAGE_INVALID_REQUEST");
        const cursor = parseCursor(cursorRaw);
        const limit = z.coerce.number().int().min(1).max(50).parse(singleParam(url, "limit") ?? 50);
        const rawResult = await dependencies.rpc("read_celebrity_lounge", {
          p_slug: slug,
          p_app_user_id: owner,
          p_before: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: limit,
          p_ids: ids,
          p_locale: contentLocale,
        });
        if (rawResult === null) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        const result = parseResult(loungeRpcSchema, rawResult);
        const last = result.messages.at(-1);
        return fanpageJson({
          ...result,
          nextCursor: ids === null && result.messages.length === limit && last ? encodeCursor(last) : null,
        });
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async post(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const url = new URL(request.url);
        const input = postLoungeMessageSchema.parse(await readSmallJson(request));
        const result = await dependencies.rpc("post_celebrity_lounge_message", {
          p_app_user_id: appUserId,
          p_slug: slug,
          p_body: input.body,
          p_idempotency_key: input.idempotencyKey,
          p_reply_to_id: input.replyToId ?? null,
          p_locale: parseLocale(url),
        });
        return fanpageJson(parseResult(postResultSchema, result));
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async remove(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        await dependencies.rpc("remove_owned_lounge_message", { p_app_user_id: appUserId, p_message_id: id });
        return fanpageJson({ removed: true });
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async react(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const input = setLoungeReactionSchema.parse(await readSmallJson(request));
        await dependencies.rpc("set_lounge_message_reaction", {
          p_app_user_id: appUserId,
          p_message_id: id,
          p_emoji: input.emoji,
          p_enabled: input.enabled,
        });
        return fanpageJson({ updated: true });
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async adminList(request: Request) {
      try {
        const correlationId = crypto.randomUUID();
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), correlationId);
        const url = new URL(request.url);
        const cursor = parseCursor(singleParam(url, "cursor"));
        const limit = z.coerce.number().int().min(1).max(50).parse(singleParam(url, "limit") ?? 50);
        const result = parseResult(adminRpcSchema, await dependencies.rpc("read_admin_lounge_messages", {
          p_actor_app_user_id: admin.appUserId,
          p_actor_admin_allowlist_id: admin.allowlistId,
          p_before: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: limit,
        }));
        const last = result.messages.at(-1);
        return fanpageJson({ ...result, nextCursor: result.messages.length === limit && last ? encodeCursor(last) : null });
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async adminHide(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const correlationId = crypto.randomUUID();
        const admin = await dependencies.authorizeAdmin(request.headers.get("authorization"), correlationId);
        const input = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(await readSmallJson(request));
        await dependencies.rpc("hide_admin_lounge_message", {
          p_actor_app_user_id: admin.appUserId,
          p_actor_admin_allowlist_id: admin.allowlistId,
          p_correlation_id: correlationId,
          p_message_id: id,
          p_reason: input.reason,
        });
        return fanpageJson({ hidden: true });
      } catch (error) {
        return fanpageFailure(error);
      }
    },
  };
}
