import "server-only";

import { z } from "zod";
import { AuthError } from "../../features/auth/domain/auth-errors";
import {
  avatarCharacterIdSchema,
  avatarCropSchema,
  type Avatar,
} from "../../features/profile/domain/avatar";
import type { AuthorizedFan } from "../fan-auth/fan-auth-gate";
import {
  AvatarImageError,
  MAX_AVATAR_FILE_BYTES,
  fetchGoogleAvatarImage,
  fetchGoogleUserInfo,
  normalizeAvatarImage,
  readAvatarMultipartBody,
  type GoogleUserInfo,
} from "./avatar-image";
import {
  AvatarRepositoryError,
  type AvatarRepository,
} from "./avatar-repository";

const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Authorization",
} as const;
const allowedUploadTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const revisionSchema = z.number().int().nonnegative();
const patchBodySchema = z
  .object({ characterId: avatarCharacterIdSchema, expectedRevision: revisionSchema })
  .strict();
const deleteBodySchema = z.object({ expectedRevision: revisionSchema }).strict();
const googleBodySchema = z.object({ accessToken: z.string().min(1).max(8192) }).strict();

export interface AvatarRouteDependencies {
  authorize(authorization: string): Promise<AuthorizedFan>;
  repository: AvatarRepository;
  normalizeImage(bytes: Uint8Array, crop?: z.infer<typeof avatarCropSchema>): Promise<Uint8Array>;
  getVerifiedGoogleSubject(authorization: string): Promise<string | null>;
  fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null>;
  fetchGoogleImage(url: string): Promise<Uint8Array | null>;
  parseUpload(request: Request): Promise<AvatarUpload>;
}

export interface AvatarUpload {
  file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
  crop: z.infer<typeof avatarCropSchema>;
  expectedRevision: number;
}

export function withAvatarRouteDefaults(
  dependencies: Omit<
    AvatarRouteDependencies,
    "normalizeImage" | "fetchGoogleUserInfo" | "fetchGoogleImage" | "parseUpload"
  > &
    Partial<
      Pick<
        AvatarRouteDependencies,
        "normalizeImage" | "fetchGoogleUserInfo" | "fetchGoogleImage" | "parseUpload"
      >
    >,
): AvatarRouteDependencies {
  return {
    ...dependencies,
    normalizeImage: dependencies.normalizeImage ?? normalizeAvatarImage,
    fetchGoogleUserInfo: dependencies.fetchGoogleUserInfo ?? fetchGoogleUserInfo,
    fetchGoogleImage: dependencies.fetchGoogleImage ?? fetchGoogleAvatarImage,
    parseUpload: dependencies.parseUpload ?? parseAvatarUpload,
  };
}

function failure(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: responseHeaders });
}

function success(avatar: Avatar): Response {
  return Response.json({ avatar }, { headers: responseHeaders });
}

async function authorize(
  request: Request,
  dependencies: AvatarRouteDependencies,
): Promise<{ fan: AuthorizedFan; authorization: string } | Response> {
  const authorization = request.headers.get("authorization") ?? "";
  try {
    return { fan: await dependencies.authorize(authorization), authorization };
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status === 401 ? 401 : 403, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    }
    return failure(503, "AVATAR_UNAVAILABLE");
  }
}

function repositoryFailure(error: unknown): Response {
  if (error instanceof AvatarRepositoryError) {
    if (error.code === "STALE_REVISION") return failure(409, "STALE_AVATAR_REVISION");
    if (error.code === "USER_UNAVAILABLE") return failure(403, "FORBIDDEN");
  }
  return failure(503, "AVATAR_UNAVAILABLE");
}

async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function formRevision(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).type === "string"
  );
}

export async function parseAvatarUpload(request: Request): Promise<AvatarUpload> {
  const body = await readAvatarMultipartBody(request);
  const form = await new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type")! },
    body: body.buffer as ArrayBuffer,
  }).formData();
  const file = form.get("file");
  const expectedRevision = formRevision(form.get("expectedRevision"));
  const rawCrop = form.get("crop");
  if (!isUploadedFile(file) || expectedRevision === null || typeof rawCrop !== "string") {
    throw new Error("INVALID_AVATAR_REQUEST");
  }
  let crop: z.infer<typeof avatarCropSchema>;
  try {
    crop = avatarCropSchema.parse(JSON.parse(rawCrop));
  } catch {
    throw new AvatarImageError("INVALID_CROP");
  }
  return { file, expectedRevision, crop };
}

export function createGetAvatarHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    try {
      return success(await dependencies.repository.ensure(owner.fan.appUserId));
    } catch (error) {
      return repositoryFailure(error);
    }
  };
}

export function createPatchAvatarHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    const parsed = patchBodySchema.safeParse(await json(request));
    if (!parsed.success) return failure(400, "INVALID_AVATAR_REQUEST");
    try {
      return success(
        await dependencies.repository.selectCharacter({
          appUserId: owner.fan.appUserId,
          ...parsed.data,
        }),
      );
    } catch (error) {
      return repositoryFailure(error);
    }
  };
}

export function createDeleteAvatarHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    const parsed = deleteBodySchema.safeParse(await json(request));
    if (!parsed.success) return failure(400, "INVALID_AVATAR_REQUEST");
    try {
      return success(
        await dependencies.repository.remove({
          appUserId: owner.fan.appUserId,
          expectedRevision: parsed.data.expectedRevision,
        }),
      );
    } catch (error) {
      return repositoryFailure(error);
    }
  };
}

export function createPutAvatarHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      return failure(400, "INVALID_AVATAR_REQUEST");
    }

    let upload: AvatarUpload;
    try {
      upload = await dependencies.parseUpload(request);
    } catch (error) {
      if (error instanceof AvatarImageError) {
        return error.code === "BODY_TOO_LARGE"
          ? failure(413, "AVATAR_FILE_TOO_LARGE")
          : failure(400, error.code === "INVALID_CROP" ? "INVALID_AVATAR_CROP" : "INVALID_AVATAR_REQUEST");
      }
      return failure(400, "INVALID_AVATAR_REQUEST");
    }

    const { file, expectedRevision, crop } = upload;
    if (!allowedUploadTypes.has(file.type.toLowerCase())) {
      return failure(415, "UNSUPPORTED_AVATAR_FILE");
    }
    if (file.size === 0) return failure(400, "INVALID_AVATAR_IMAGE");
    if (file.size > MAX_AVATAR_FILE_BYTES) return failure(413, "AVATAR_FILE_TOO_LARGE");

    try {
      const bytes = await dependencies.normalizeImage(new Uint8Array(await file.arrayBuffer()), crop);
      return success(
        await dependencies.repository.replaceImage({
          appUserId: owner.fan.appUserId,
          source: "upload",
          expectedRevision,
          bytes,
        }),
      );
    } catch (error) {
      if (error instanceof AvatarImageError) {
        if (error.code === "BODY_TOO_LARGE") return failure(413, "AVATAR_FILE_TOO_LARGE");
        return failure(400, error.code === "INVALID_CROP" ? "INVALID_AVATAR_CROP" : "INVALID_AVATAR_IMAGE");
      }
      return repositoryFailure(error);
    }
  };
}

export function createGetAvatarImageHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    const rawRevision = new URL(request.url).searchParams.get("revision");
    const revision = rawRevision === null ? null : formRevision(rawRevision);
    if (revision === null) return failure(400, "INVALID_AVATAR_REQUEST");
    try {
      const image = await dependencies.repository.image(owner.fan.appUserId, revision);
      if (!image) return failure(404, "AVATAR_IMAGE_NOT_FOUND");
      return new Response(image.bytes, {
        headers: {
          ...responseHeaders,
          "content-type": image.contentType,
          "content-length": String(image.bytes.byteLength),
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return repositoryFailure(error);
    }
  };
}

export function createImportGoogleAvatarHandler(dependencies: AvatarRouteDependencies) {
  return async (request: Request): Promise<Response> => {
    const owner = await authorize(request, dependencies);
    if (owner instanceof Response) return owner;
    const parsed = googleBodySchema.safeParse(await json(request));
    if (!parsed.success) return failure(400, "INVALID_GOOGLE_AVATAR_REQUEST");

    let current: Avatar;
    try {
      current = await dependencies.repository.ensure(owner.fan.appUserId);
    } catch (error) {
      return repositoryFailure(error);
    }
    if (current.source !== "default") return success(current);

    let verifiedSubject: string | null;
    try {
      verifiedSubject = await dependencies.getVerifiedGoogleSubject(owner.authorization);
    } catch {
      return failure(503, "GOOGLE_AVATAR_UNAVAILABLE");
    }
    if (!verifiedSubject) return failure(403, "GOOGLE_ACCOUNT_MISMATCH");

    const info = await dependencies.fetchGoogleUserInfo(parsed.data.accessToken);
    if (!info) return success(current);
    if (info.sub !== verifiedSubject) return failure(403, "GOOGLE_ACCOUNT_MISMATCH");
    if (!info.picture) return success(current);
    const sourceImage = await dependencies.fetchGoogleImage(info.picture);
    if (!sourceImage) return success(current);

    try {
      const bytes = await dependencies.normalizeImage(sourceImage);
      return success(
        await dependencies.repository.replaceImage({
          appUserId: owner.fan.appUserId,
          source: "google",
          expectedRevision: current.revision,
          bytes,
        }),
      );
    } catch {
      // This endpoint may run as a login enhancement. Import failures preserve
      // the existing avatar and must not turn a valid login into a failure.
      try {
        return success(await dependencies.repository.ensure(owner.fan.appUserId));
      } catch (error) {
        return repositoryFailure(error);
      }
    }
  };
}
