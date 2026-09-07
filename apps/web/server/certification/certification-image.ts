import "server-only";
import sharp from "sharp";

export const MAX_CERTIFICATION_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_CERTIFICATION_MULTIPART_BYTES = MAX_CERTIFICATION_FILE_BYTES + 196_608;
export const MAX_CERTIFICATION_PIXELS = 24_000_000;

export class CertificationImageError extends Error {
  constructor(readonly code: "INVALID_IMAGE" | "BODY_TOO_LARGE") { super(code); this.name = "CertificationImageError"; }
}

export async function normalizeCertificationImage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  if (!bytes.byteLength || bytes.byteLength > MAX_CERTIFICATION_FILE_BYTES) throw new CertificationImageError(bytes.byteLength > MAX_CERTIFICATION_FILE_BYTES ? "BODY_TOO_LARGE" : "INVALID_IMAGE");
  try {
    const input = sharp(bytes, { failOn: "error", limitInputPixels: MAX_CERTIFICATION_PIXELS, sequentialRead: true });
    const metadata = await input.metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new CertificationImageError("INVALID_IMAGE");
    if (metadata.width * metadata.height > MAX_CERTIFICATION_PIXELS) throw new CertificationImageError("INVALID_IMAGE");
    const output = await input.rotate().webp({ quality: 88, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (output.data.byteLength > MAX_CERTIFICATION_FILE_BYTES) throw new CertificationImageError("BODY_TOO_LARGE");
    return { bytes: new Uint8Array(output.data), width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof CertificationImageError) throw error;
    throw new CertificationImageError("INVALID_IMAGE");
  }
}
