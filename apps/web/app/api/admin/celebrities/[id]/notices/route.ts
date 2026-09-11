import { z } from "zod";
import { createNoticeDependencies } from "../../../../../../server/notice/notice-dependencies";
import { noticeSlugSchema } from "../../../../../../server/notice/notice-domain";
import { AuthError } from "../../../../../../features/auth/domain/auth-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

const documentSchema = z.record(z.string(), z.unknown());
const saveSchema = z.object({
  action: z.literal("save"),
  id: z.string().uuid().optional(),
  expectedRevision: z.number().int().positive().optional(),
  slug: noticeSlugSchema,
  pinned: z.boolean(),
  localizations: z.object({
    ko: z.object({ title: z.string().trim().min(1).max(160), body: documentSchema }),
    en: z.object({ title: z.string().trim().min(1).max(160), body: documentSchema }),
  }),
});
const stateSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive"]),
  id: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(10).optional(),
});

function correlation(request: Request) {
  const value = request.headers.get("x-correlation-id");
  return value && z.string().uuid().safeParse(value).success ? value : crypto.randomUUID();
}
async function admin(request: Request, id: string) {
  const deps = createNoticeDependencies();
  const session = await deps.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId: id });
  return { deps, session };
}
function failure(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "INVALID_REQUEST" }, 400);
  if (error instanceof AuthError) {
    return json(
      { error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
      error.status === 401 ? 401 : 403,
    );
  }
  return json({ error: "NOTICE_ADMIN_ERROR", message: "Notice request failed" }, 409);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const c = correlation(request);
    const { deps, session } = await admin(request, c);
    return json(await deps.repository.listAdmin(session, id));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: celebrityId } = await context.params;
    z.string().uuid().parse(celebrityId);
    const c = correlation(request);
    const { deps, session } = await admin(request, c);
    if (session.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
    const value = await request.json();
    if (value?.action === "save") {
      const body = saveSchema.parse(value);
      return json(await deps.repository.save(session, c, { ...body, celebrityId }));
    }
    const body = stateSchema.parse(value);
    return json(await deps.repository.state(session, c, body));
  } catch (error) { return failure(error); }
}
