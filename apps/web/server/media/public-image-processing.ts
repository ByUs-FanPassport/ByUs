import "server-only";
import { createHash } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const MAX_PUBLIC_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PUBLIC_IMAGE_MULTIPART_BYTES = MAX_PUBLIC_IMAGE_BYTES + 256 * 1024;
export const MAX_PUBLIC_IMAGE_PIXELS = 40_000_000;
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class PublicImageError extends Error {
  constructor(readonly code: "BODY_TOO_LARGE" | "INVALID_IMAGE" | "INVALID_SOURCE" | "UNAVAILABLE" | "CONFLICT") {
    super(code); this.name = "PublicImageError";
  }
}

export type NormalizedPublicImage = { bytes: Uint8Array; width: number; height: number; mimeType: "image/webp"; sha256: string };

export async function normalizePublicImage(bytes: Uint8Array): Promise<NormalizedPublicImage> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PUBLIC_IMAGE_BYTES) {
    throw new PublicImageError(bytes.byteLength > MAX_PUBLIC_IMAGE_BYTES ? "BODY_TOO_LARGE" : "INVALID_IMAGE");
  }
  try {
    const pipeline = sharp(bytes, { failOn: "error", limitInputPixels: MAX_PUBLIC_IMAGE_PIXELS, sequentialRead: true });
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height || !SUPPORTED_FORMATS.has(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || metadata.width * metadata.height > MAX_PUBLIC_IMAGE_PIXELS) {
      throw new PublicImageError("INVALID_IMAGE");
    }
    const output = await pipeline.rotate().webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (!output.data.byteLength || output.data.byteLength > MAX_PUBLIC_IMAGE_BYTES || output.info.width * output.info.height > MAX_PUBLIC_IMAGE_PIXELS) {
      throw new PublicImageError(output.data.byteLength > MAX_PUBLIC_IMAGE_BYTES ? "BODY_TOO_LARGE" : "INVALID_IMAGE");
    }
    const normalized = new Uint8Array(output.data);
    return { bytes: normalized, width: output.info.width, height: output.info.height, mimeType: "image/webp", sha256: createHash("sha256").update(normalized).digest("hex") };
  } catch (error) {
    if (error instanceof PublicImageError) throw error;
    throw new PublicImageError("INVALID_IMAGE");
  }
}

export async function readLocalPublicImage(source: string, publicRoot = path.join(process.cwd(), "public")): Promise<Uint8Array> {
  let pathname: string;
  try {
    const parsed = new URL(source, "https://local.invalid");
    if (parsed.origin !== "https://local.invalid" || parsed.search || parsed.hash || !parsed.pathname.startsWith("/images/")) throw new Error();
    pathname = decodeURIComponent(parsed.pathname);
    if (pathname.includes("\\") || pathname.split("/").some(segment => segment === "." || segment === "..")) throw new Error();
  } catch { throw new PublicImageError("INVALID_SOURCE"); }
  try {
    const root = await realpath(publicRoot);
    const target = await realpath(path.join(root, pathname.slice(1)));
    if (!target.startsWith(`${root}${path.sep}`)) throw new PublicImageError("INVALID_SOURCE");
    const bytes = new Uint8Array(await readFile(target));
    if (bytes.byteLength > MAX_PUBLIC_IMAGE_BYTES) throw new PublicImageError("BODY_TOO_LARGE");
    return bytes;
  } catch (error) {
    if (error instanceof PublicImageError) throw error;
    throw new PublicImageError("INVALID_SOURCE");
  }
}

export function currentCmsAssetPath(source: string, supabaseUrl: string): string {
  try {
    const url = new URL(source);
    const origin = new URL(supabaseUrl).origin;
    const prefix = "/storage/v1/object/public/cms-assets/";
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error();
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!objectPath || objectPath.includes("\\") || objectPath.split("/").some(segment => !segment || segment === "." || segment === "..")) throw new Error();
    return objectPath;
  } catch { throw new PublicImageError("INVALID_SOURCE"); }
}

export async function fetchCurrentCmsAsset(source: string, supabaseUrl: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  currentCmsAssetPath(source, supabaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(source, { headers: { accept: "image/jpeg,image/png,image/webp" }, redirect: "error", signal: controller.signal });
    if (!response.ok || !response.body) throw new PublicImageError("INVALID_SOURCE");
    const declared = response.headers.get("content-length");
    if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_PUBLIC_IMAGE_BYTES)) throw new PublicImageError("BODY_TOO_LARGE");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > MAX_PUBLIC_IMAGE_BYTES) { await reader.cancel(); throw new PublicImageError("BODY_TOO_LARGE"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } catch (error) {
    if (error instanceof PublicImageError) throw error;
    throw new PublicImageError("INVALID_SOURCE");
  } finally { clearTimeout(timeout); }
}
