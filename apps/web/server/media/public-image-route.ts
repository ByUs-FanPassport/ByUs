import "server-only";
import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import type { AdminSession } from "../admin/admin-session-gate";
import { boundedJson, boundedMultipart, CertificationBodyError, correlation, json } from "../certification/certification-http";
import { imageRoleWriteSchema, ownerTypeSchema } from "./image-schemas";
import { MAX_PUBLIC_IMAGE_BYTES, MAX_PUBLIC_IMAGE_MULTIPART_BYTES, PublicImageError, readLocalPublicImage } from "./public-image-processing";
import type { PublicImageRepository } from "./public-image-repository";

export interface PublicImageRouteDependencies {
  authorize(input: { authorization: string; correlationId: string }): Promise<AdminSession>;
  repository: PublicImageRepository;
  invalidatePublicContent(): void;
  publicRoot?: string;
}
const ownerQuerySchema = z.object({ ownerType: ownerTypeSchema, ownerId: z.uuid() }).strict();
const sourceSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function" && typeof (value as File).size === "number";
}
function mapError(error: unknown): Response {
  if (error instanceof AuthError) return json({ error: { code: error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" } }, error.status);
  if (error instanceof CertificationBodyError) return json({ error: { code: error.code } }, error.code === "BODY_TOO_LARGE" ? 413 : 400);
  if (error instanceof PublicImageError) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : error.code === "CONFLICT" ? 409 : error.code === "UNAVAILABLE" ? 503 : 400;
    return json({ error: { code: error.code } }, status);
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: { code: "INVALID_REQUEST" } }, 400);
  return json({ error: { code: "PUBLIC_IMAGE_UNAVAILABLE" } }, 503);
}
async function authorize(request: Request, dependencies: PublicImageRouteDependencies, correlationId: string) {
  return dependencies.authorize({ authorization: request.headers.get("authorization") ?? "", correlationId });
}

export function createPostPublicImageAssetHandler(dependencies: PublicImageRouteDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const correlationId = correlation(request);
    try {
      const actor = await authorize(request, dependencies, correlationId);
      if (actor.role === "viewer") return json({ error: { code: "FORBIDDEN" } }, 403);
      const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
      let bytes: Uint8Array;
      if (contentType.startsWith("multipart/form-data;")) {
        const form = await boundedMultipart(request, MAX_PUBLIC_IMAGE_MULTIPART_BYTES);
        const entries = [...form.entries()];
        const file = entries.length === 1 && entries[0][0] === "file" && isUploadedFile(entries[0][1]) ? entries[0][1] : null;
        if (!file) throw new PublicImageError("INVALID_IMAGE");
        if (file.size > MAX_PUBLIC_IMAGE_BYTES) throw new PublicImageError("BODY_TOO_LARGE");
        bytes = new Uint8Array(await file.arrayBuffer());
      } else if (contentType.startsWith("application/json")) {
        const source = sourceSchema.parse(await boundedJson(request, 4_096)).url;
        bytes = source.startsWith("/images/")
          ? await readLocalPublicImage(source, dependencies.publicRoot)
          : await dependencies.repository.downloadCurrentCmsAsset(source);
      } else {
        return json({ error: { code: "INVALID_REQUEST" } }, 400);
      }
      const asset = await dependencies.repository.normalizeAndRegister(actor, correlationId, bytes);
      return json({ asset }, 201);
    } catch (error) { return mapError(error); }
  };
}

export function createImageRoleHandlers(dependencies: PublicImageRouteDependencies) {
  return {
    GET: async (request: Request): Promise<Response> => {
      const correlationId = correlation(request);
      try {
        const actor = await authorize(request, dependencies, correlationId);
        const url = new URL(request.url);
        const query = ownerQuerySchema.parse({ ownerType: url.searchParams.get("ownerType"), ownerId: url.searchParams.get("ownerId") });
        return json({ items: await dependencies.repository.listRoles(actor, query.ownerType, query.ownerId) });
      } catch (error) { return mapError(error); }
    },
    POST: async (request: Request): Promise<Response> => {
      const correlationId = correlation(request);
      try {
        const actor = await authorize(request, dependencies, correlationId);
        if (actor.role === "viewer") return json({ error: { code: "FORBIDDEN" } }, 403);
        const input = imageRoleWriteSchema.parse(await boundedJson(request, 64_000));
        const item = await dependencies.repository.setRole(actor, correlationId, input);
        dependencies.invalidatePublicContent();
        return json({ item });
      } catch (error) { return mapError(error); }
    },
  };
}
