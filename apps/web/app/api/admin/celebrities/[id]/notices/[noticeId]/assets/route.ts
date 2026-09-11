import { z } from "zod";
import { createNoticeDependencies } from "../../../../../../../../server/notice/notice-dependencies";
import { AuthError } from "../../../../../../../../features/auth/domain/auth-errors";

export const runtime = "nodejs";

const privateHeaders = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export async function POST(request: Request, context: { params: Promise<{ id: string; noticeId: string }> }) {
  try {
    const { id, noticeId } = await context.params;
    z.string().uuid().parse(id);
    z.string().uuid().parse(noticeId);
    const requestedCorrelationId = request.headers.get("x-correlation-id");
    const correlationId = requestedCorrelationId && z.string().uuid().safeParse(requestedCorrelationId).success
      ? requestedCorrelationId
      : crypto.randomUUID();
    const deps = createNoticeDependencies();
    const session = await deps.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
    if (session.role === "viewer") return json({ error: "FORBIDDEN" }, 403);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "FILE_REQUIRED" }, 400);
    return json(await deps.repository.upload(session, { celebrityId: id, noticeId, file }));
  } catch (error) {
    if (error instanceof AuthError) {
      return json(
        { error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
        error.status === 401 ? 401 : 403,
      );
    }
    return json({ error: "NOTICE_ASSET_ERROR", message: "Upload failed" }, 400);
  }
}
