import { z } from "zod";
import type { AdminSession } from "../admin/admin-session-gate";
import {
  CmsError,
  commandPayload,
  quizCommandPayload,
  type ContentCmsRepository,
} from "./content-cms";
export interface CmsRouteDeps {
  authorize(input: {
    authorization: string;
    correlationId: string;
  }): Promise<AdminSession>;
  repository: ContentCmsRepository;
  invalidatePublicContent(): void;
}
export function correlation(request: Request) {
  const value = request.headers.get("x-correlation-id")?.trim();
  return z.string().uuid().safeParse(value).success
    ? value!
    : crypto.randomUUID();
}
async function actor(request: Request, deps: CmsRouteDeps, id: string) {
  return deps.authorize({
    authorization: request.headers.get("authorization") ?? "",
    correlationId: id,
  });
}
function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "INVALID_REQUEST", issues: error.issues },
      { status: 400 },
    );
  if (error instanceof CmsError)
    return Response.json(
      { error: error.code, message: error.message },
      {
        status:
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "INVALID"
                ? 409
                : 503,
      },
    );
  return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}
export function celebrityHandlers(deps: CmsRouteDeps) {
  return {
    async GET(request: Request) {
      try {
        const c = correlation(request),
          admin = await actor(request, deps, c),
          id = new URL(request.url).searchParams.get("id");
        return Response.json({
          items: await deps.repository.celebrities(admin, id),
          role: admin.role,
        });
      } catch (e) {
        return failure(e);
      }
    },
    async POST(request: Request) {
      try {
        const c = correlation(request),
          admin = await actor(request, deps, c),
          body = commandPayload.parse(await request.json());
        if (body.action === "save")
          return Response.json(
            await deps.repository.saveCelebrity(
              admin,
              c,
              body.celebrityId,
              body.payload,
            ),
          );
        if (body.action === "archive") {
          const result = await deps.repository.archive(
            admin,
            c,
            body.celebrityId,
            body.reason,
          );
          deps.invalidatePublicContent();
          return Response.json(result);
        }
        const result = await deps.repository.publication(
          admin,
          c,
          body.celebrityId,
          body.action === "publish",
        );
        deps.invalidatePublicContent();
        return Response.json(result);
      } catch (e) {
        return failure(e);
      }
    },
  };
}
export function quizHandlers(deps: CmsRouteDeps) {
  return {
    async GET(request: Request, celebrityId: string) {
      try {
        const c = correlation(request),
          admin = await actor(request, deps, c);
        return Response.json({
          items: await deps.repository.quizzes(admin, celebrityId),
          role: admin.role,
        });
      } catch (e) {
        return failure(e);
      }
    },
    async POST(request: Request, celebrityId: string) {
      try {
        const c = correlation(request),
          admin = await actor(request, deps, c),
          body = quizCommandPayload.parse(await request.json());
        if (body.action === "save")
          return Response.json(
            await deps.repository.saveQuiz(admin, c, celebrityId, body.payload),
          );
        const result = await deps.repository.quizCommand(
          admin,
          c,
          celebrityId,
          body.action,
          body.quizId,
        );
        if (body.action === "publish") deps.invalidatePublicContent();
        return Response.json(result);
      } catch (e) {
        return failure(e);
      }
    },
  };
}
