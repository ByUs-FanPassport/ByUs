import "server-only";
import { createAdminDirectorySchema, updateAdminDirectorySchema } from "../../features/auth/domain/admin-directory";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "./admin-session-gate";
import { AdminDirectoryRepositoryError, type AdminDirectoryRepository } from "./admin-directory-repository";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const errorResponse = (code: string, status: number) => Response.json({ error: { code } }, { status, headers });
export function createAdminDirectoryHandlers(dependencies: {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: AdminDirectoryRepository;
}) {
  async function handle(request: Request): Promise<Response> {
    const correlationId = crypto.randomUUID();
    try {
      const actor = await dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
      if (actor.role !== "admin") return errorResponse("FORBIDDEN", 403);
      if (new URL(request.url).search) return errorResponse("INVALID_INPUT", 400);
      if (request.method === "GET") return Response.json(await dependencies.repository.read(actor), { headers });
      if (!["POST", "PATCH"].includes(request.method)) return errorResponse("METHOD_NOT_ALLOWED", 405);
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return errorResponse("INVALID_INPUT", 400);
      let body: unknown;
      try {
        const raw = await request.text();
        if (raw.length > 4096) return errorResponse("INVALID_INPUT", 400);
        body = JSON.parse(raw);
      } catch { return errorResponse("INVALID_INPUT", 400); }
      if (request.method === "POST") {
        const parsed = createAdminDirectorySchema.safeParse(body);
        if (!parsed.success) return errorResponse("INVALID_INPUT", 400);
        const item = await dependencies.repository.create(actor, parsed.data, correlationId);
        return Response.json({ item }, { status: 201, headers });
      }
      const parsed = updateAdminDirectorySchema.safeParse(body);
      if (!parsed.success) return errorResponse("INVALID_INPUT", 400);
      const item = await dependencies.repository.update(actor, parsed.data, correlationId);
      return Response.json({ item }, { headers });
    } catch (error) {
      if (error instanceof AuthError) return errorResponse(error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", error.status === 401 ? 401 : 403);
      if (error instanceof AdminDirectoryRepositoryError) {
        const status = error.code === "ADMIN_DIRECTORY_FORBIDDEN" ? 403
          : error.code === "ADMIN_DIRECTORY_NOT_FOUND" ? 404
          : error.code === "ADMIN_DIRECTORY_UNAVAILABLE" ? 503
          : error.code === "ADMIN_DIRECTORY_INVALID_INPUT" ? 400 : 409;
        return errorResponse(status === 403 ? "FORBIDDEN" : error.code, status);
      }
      return errorResponse("ADMIN_DIRECTORY_UNAVAILABLE", 503);
    }
  }
  return { GET: handle, POST: handle, PATCH: handle };
}
