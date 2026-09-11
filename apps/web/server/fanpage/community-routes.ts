import "server-only";

import { z } from "zod";
import {
  cheerCommentSchema,
  fanCommunitySchema,
  postCheerSchema,
} from "../../features/fanpage/domain/fan-community";
import { celebritySlugSchema } from "../../features/fanpage/domain/community";
import {
  fanpageFailure,
  fanpageJson,
  type FanpageDependencies,
} from "./routes";

const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
const cheerRpcSchema = z.object({
  total: z.number().int().nonnegative(),
  comments: z.array(cheerCommentSchema).max(21),
}).strict();
const postResultSchema = z.object({ id: z.uuid(), replayed: z.boolean() }).strict();

function parseResult<T>(schema: z.ZodType<T>, result: unknown): T {
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new Error("FANPAGE_INVALID_RESPONSE");
  return parsed.data;
}

function singleParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("FANPAGE_INVALID_REQUEST");
  return values[0] ?? null;
}

function parseLocale(url: URL): "ko" | "en" {
  return z.enum(["ko", "en"]).parse(singleParam(url, "locale") ?? "ko");
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

async function optionalOwner(request: Request, dependencies: FanpageDependencies) {
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

export function createFanCommunityHandlers(dependencies: FanpageDependencies) {
  return {
    async fans(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        await optionalOwner(request, dependencies);
        const raw = await dependencies.rpc("read_celebrity_fan_community", {
          p_slug: slug,
          p_locale: parseLocale(new URL(request.url)),
        });
        if (raw === null) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        return fanpageJson(parseResult(fanCommunitySchema, raw));
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async cheers(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const owner = await optionalOwner(request, dependencies);
        const url = new URL(request.url);
        const limit = z.coerce.number().int().min(1).max(20).parse(singleParam(url, "limit") ?? 5);
        const cursor = parseCursor(singleParam(url, "cursor"));
        const raw = await dependencies.rpc("read_celebrity_cheers", {
          p_slug: slug,
          p_app_user_id: owner,
          p_before: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: limit + 1,
          p_locale: parseLocale(url),
        });
        if (raw === null) return fanpageJson({ error: { code: "FANPAGE_NOT_FOUND" } }, 404);
        const result = parseResult(cheerRpcSchema, raw);
        const hasMore = result.comments.length > limit;
        const comments = result.comments.slice(0, limit);
        const last = comments.at(-1);
        return fanpageJson({
          total: result.total,
          comments,
          nextCursor: hasMore && last ? encodeCursor(last) : null,
        });
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async postCheer(request: Request, slug: string) {
      try {
        celebritySlugSchema.parse(slug);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const input = postCheerSchema.parse(await readSmallJson(request));
        const result = await dependencies.rpc("post_celebrity_cheer", {
          p_app_user_id: appUserId,
          p_slug: slug,
          p_body: input.body,
          p_idempotency_key: input.idempotencyKey,
          p_locale: parseLocale(new URL(request.url)),
        });
        return fanpageJson(parseResult(postResultSchema, result));
      } catch (error) {
        return fanpageFailure(error);
      }
    },

    async removeCheer(request: Request, id: string) {
      try {
        z.uuid().parse(id);
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        await dependencies.rpc("remove_owned_lounge_message", {
          p_app_user_id: appUserId,
          p_message_id: id,
        });
        return fanpageJson({ removed: true });
      } catch (error) {
        return fanpageFailure(error);
      }
    },
  };
}
