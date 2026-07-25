import { z } from "zod";
import { createNoticeDependencies } from "../../../../../../../../server/notice/notice-dependencies";
import { AuthError } from "../../../../../../../../features/auth/domain/auth-errors";

export const runtime = "nodejs";

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
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "FILE_REQUIRED" }, { status: 400 });
    return Response.json(await deps.repository.upload(session, { celebrityId: id, noticeId, file }));
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json(
        { error: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
        { status: error.status === 401 ? 401 : 403 },
      );
    }
    return Response.json({ error: "NOTICE_ASSET_ERROR", message: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}
