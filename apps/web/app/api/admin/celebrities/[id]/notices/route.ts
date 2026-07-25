import { z } from "zod";
import { createNoticeDependencies } from "../../../../../../server/notice/notice-dependencies";
import { noticeSlugSchema } from "../../../../../../server/notice/notice-domain";
import { AuthError } from "../../../../../../features/auth/domain/auth-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_REQUEST", issues: error.issues }, { status: 400 });
  if (error instanceof AuthError) {
    return Response.json(
      { error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
      { status: error.status === 401 ? 401 : 403 },
    );
  }
  return Response.json({ error: "NOTICE_ADMIN_ERROR", message: error instanceof Error ? error.message : "Request failed" }, { status: 409 });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const c = correlation(request);
    const { deps, session } = await admin(request, c);
    return Response.json(await deps.repository.listAdmin(session, id));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: celebrityId } = await context.params;
    z.string().uuid().parse(celebrityId);
    const c = correlation(request);
    const { deps, session } = await admin(request, c);
    const value = await request.json();
    if (value?.action === "save") {
      const body = saveSchema.parse(value);
      return Response.json(await deps.repository.save(session, c, { ...body, celebrityId }));
    }
    const body = stateSchema.parse(value);
    return Response.json(await deps.repository.state(session, c, body));
  } catch (error) { return failure(error); }
}
