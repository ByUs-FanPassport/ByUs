import "server-only";

import sharp, { type Metadata } from "sharp";
import { avatarCropSchema, type AvatarCrop } from "../../features/profile/domain/avatar";

export const MAX_AVATAR_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_AVATAR_MULTIPART_BYTES = MAX_AVATAR_FILE_BYTES + 256 * 1024;
export const MAX_AVATAR_PIXELS = 40_000_000;
const AVATAR_OUTPUT_SIZE = 512;
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class AvatarImageError extends Error {
  constructor(readonly code: "BODY_TOO_LARGE" | "INVALID_IMAGE" | "INVALID_CROP") {
    super(code);
    this.name = "AvatarImageError";
  }
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = signal?.aborted ?? false;
  const abort = () => {
    aborted = true;
    void reader.cancel(new Error("Response body deadline exceeded")).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (aborted) throw new Error("Response body deadline exceeded");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new AvatarImageError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (aborted) throw new Error("Response body deadline exceeded");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readAvatarMultipartBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_AVATAR_MULTIPART_BYTES) {
      throw new AvatarImageError("BODY_TOO_LARGE");
    }
  }
  return readStreamBounded(request.body, MAX_AVATAR_MULTIPART_BYTES);
}

export async function readResponseBodyBounded(
  response: Response,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    throw new AvatarImageError("BODY_TOO_LARGE");
  }
  return readStreamBounded(response.body, limit, signal);
}

function orientedDimensions(metadata: Metadata): { width: number; height: number } {
  if (!metadata.width || !metadata.height || !SUPPORTED_FORMATS.has(metadata.format ?? "")) {
    throw new AvatarImageError("INVALID_IMAGE");
  }
  const swap = metadata.orientation !== undefined && [5, 6, 7, 8].includes(metadata.orientation);
  const width = swap ? metadata.height : metadata.width;
  const height = swap ? metadata.width : metadata.height;
  if (width * height > MAX_AVATAR_PIXELS) throw new AvatarImageError("INVALID_IMAGE");
  return { width, height };
}

export async function normalizeAvatarImage(
  bytes: Uint8Array,
  requestedCrop?: AvatarCrop,
): Promise<Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_FILE_BYTES) {
    throw new AvatarImageError(bytes.byteLength > MAX_AVATAR_FILE_BYTES ? "BODY_TOO_LARGE" : "INVALID_IMAGE");
  }

  try {
    const pipeline = sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_PIXELS,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    const { width, height } = orientedDimensions(metadata);
    const shortest = Math.min(width, height);
    const crop = requestedCrop
      ? avatarCropSchema.parse(requestedCrop)
      : {
          x: (width - shortest) / 2 / width,
          y: (height - shortest) / 2 / height,
          size: 1,
        };
    const sideFloat = crop.size * shortest;
    const leftFloat = crop.x * width;
    const topFloat = crop.y * height;
    if (
      leftFloat + sideFloat > width + Number.EPSILON * width ||
      topFloat + sideFloat > height + Number.EPSILON * height
    ) {
      throw new AvatarImageError("INVALID_CROP");
    }
    const side = Math.min(shortest, Math.max(1, Math.round(sideFloat)));
    const left = Math.min(width - side, Math.max(0, Math.round(leftFloat)));
    const top = Math.min(height - side, Math.max(0, Math.round(topFloat)));

    const output = await pipeline
      .rotate()
      .extract({ left, top, width: side, height: side })
      .resize(AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE, { fit: "fill" })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
    return new Uint8Array(output);
  } catch (error) {
    if (error instanceof AvatarImageError) throw error;
    if (error instanceof Error && error.name === "ZodError") {
      throw new AvatarImageError("INVALID_CROP");
    }
    throw new AvatarImageError("INVALID_IMAGE");
  }
}

export interface GoogleUserInfo {
  sub: string;
  picture: string | null;
}

function googleImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.toLowerCase().endsWith(".googleusercontent.com")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchBodyWithTimeout(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  limit: number,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(input, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
    });
    const bytes = await readResponseBodyBounded(response, limit, controller.signal);
    return { response, bytes };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleUserInfo | null> {
  try {
    const { response, bytes } = await fetchBodyWithTimeout(
      fetcher,
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } },
      4_000,
      64 * 1024,
    );
    if (!response.ok) return null;
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown; picture?: unknown };
    if (typeof value.sub !== "string" || !value.sub.trim()) return null;
    return { sub: value.sub, picture: googleImageUrl(value.picture) };
  } catch {
    return null;
  }
}

export async function fetchGoogleAvatarImage(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const safeUrl = googleImageUrl(url);
  if (!safeUrl) return null;
  try {
    const { response, bytes } = await fetchBodyWithTimeout(
      fetcher,
      safeUrl,
      { headers: { accept: "image/jpeg,image/png,image/webp" } },
      5_000,
      MAX_AVATAR_FILE_BYTES,
    );
    if (!response.ok) return null;
    return bytes;
  } catch {
    return null;
  }
}
