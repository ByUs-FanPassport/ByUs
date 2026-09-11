import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";
import { createInquirySchema, detailResultSchema, inquiryStatusSchema, listResultSchema, mutationSchema, postMessageSchema, resolveInquirySchema } from "@/features/support/domain/inquiry";
import type { AdminSession } from "../admin/admin-session-gate";

export interface SupportDependencies {
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  authorize(authorization: string | null): Promise<{ appUserId: string }>;
  authorizeAdmin(authorization: string | null, correlationId: string): Promise<AdminSession>;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
export const supportJson = (value: unknown, status = 200) => Response.json(value, { status, headers });
export function supportFailure(error: unknown) {
  if (error instanceof AuthError) return supportJson({ error: { code: "AUTHENTICATION_REQUIRED" } }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return supportJson({ error: { code: "CS_INVALID_REQUEST" } }, 400);
  const code = error instanceof Error ? error.message : "";
  const status = ({ CS_FORBIDDEN: 403, CS_NOT_FOUND: 404, CS_RATE_LIMITED: 429, CS_IDEMPOTENCY_CONFLICT: 409,
    CS_STALE_VERSION: 409, CS_INVALID_REQUEST: 400, CS_BODY_TOO_LARGE: 413 } as Record<string, number>)[code];
  return supportJson({ error: { code: status ? code : "CS_UNAVAILABLE" } }, status ?? 503);
}
function result<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("CS_INVALID_RESPONSE");
  return parsed.data;
}
async function smallJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      // 4,000 characters may be four-byte Unicode. Bound the stream, not just Content-Length.
      if (bytes > 20_000) { await reader.cancel(); throw new Error("CS_BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
function readQuery(request: Request, admin: boolean, list: boolean) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(list && admin ? ["cursor", "status"] : ["cursor"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error("CS_INVALID_REQUEST");
  }
  const cursor = params.get("cursor");
  const before = cursor ? cursorSchema.parse(JSON.parse(Buffer.from(z.string().max(240).parse(cursor), "base64url").toString("utf8"))) : null;
  return {
    p_before: before?.at ?? null, p_before_id: before?.id ?? null,
    ...(list ? { p_status: inquiryStatusSchema.nullable().parse(params.get("status")) } : {}),
  };
}
function encodeCursor(at: string, id: string) { return Buffer.from(JSON.stringify({ at, id })).toString("base64url"); }

export function createSupportHandlers(dependencies: SupportDependencies) {
  async function actor(request: Request, admin: boolean, writable = false) {
    const authorization = request.headers.get("authorization");
    if (!admin) return { p_app_user_id: (await dependencies.authorize(authorization)).appUserId, p_admin_allowlist_id: null };
    const session = await dependencies.authorizeAdmin(authorization, crypto.randomUUID());
    if (writable && session.role === "viewer") throw new Error("CS_FORBIDDEN");
    return { p_app_user_id: session.appUserId, p_admin_allowlist_id: session.allowlistId };
  }
  return {
    async list(request: Request, admin = false) {
      try {
        const owner = await actor(request, admin);
        const data = result(listResultSchema, await dependencies.rpc("cs_list", { ...owner, ...readQuery(request, admin, true) }));
        const last = data.inquiries.at(-1);
        if (data.hasMore && !last) throw new Error("CS_INVALID_RESPONSE");
        return supportJson({ inquiries: data.inquiries, nextCursor: data.hasMore && last ? encodeCursor(last.updatedAt, last.id) : null });
      } catch (error) { return supportFailure(error); }
    },
    async detail(request: Request, id: string, admin = false) {
      try {
        const owner = await actor(request, admin);
        z.uuid().parse(id);
        const data = result(detailResultSchema, await dependencies.rpc("cs_read", { ...owner, p_inquiry_id: id, ...readQuery(request, admin, false) }));
        if (data.inquiry.id !== id || (data.hasMore && !data.messages.length)) throw new Error("CS_INVALID_RESPONSE");
        const first = data.messages[0];
        return supportJson({ inquiry: data.inquiry, messages: data.messages, nextCursor: data.hasMore && first ? encodeCursor(first.createdAt, first.id) : null });
      } catch (error) { return supportFailure(error); }
    },
    async create(request: Request) {
      try {
        const { appUserId } = await dependencies.authorize(request.headers.get("authorization"));
        const input = createInquirySchema.parse(await smallJson(request));
        const data = result(mutationSchema, await dependencies.rpc("cs_create", { p_app_user_id: appUserId, p_subject: input.subject,
          p_body: input.body, p_locale: input.locale, p_idempotency_key: input.idempotencyKey }));
        return supportJson(data, data.replayed ? 200 : 201);
      } catch (error) { return supportFailure(error); }
    },
    async post(request: Request, id: string, admin = false) {
      try {
        const owner = await actor(request, admin, true);
        z.uuid().parse(id);
        const input = postMessageSchema.parse(await smallJson(request));
        return supportJson(result(mutationSchema, await dependencies.rpc("cs_post", { ...owner, p_inquiry_id: id,
          p_body: input.body, p_idempotency_key: input.idempotencyKey, p_correlation_id: admin ? crypto.randomUUID() : null })));
      } catch (error) { return supportFailure(error); }
    },
    async resolve(request: Request, id: string) {
      try {
        const owner = await actor(request, true, true);
        z.uuid().parse(id);
        const input = resolveInquirySchema.parse(await smallJson(request));
        const data = await dependencies.rpc("cs_resolve", { ...owner, p_inquiry_id: id,
          p_expected_version: input.expectedVersion, p_correlation_id: crypto.randomUUID() });
        return supportJson(result(z.object({ resolved: z.literal(true) }).strict(), data));
      } catch (error) { return supportFailure(error); }
    },
  };
}
