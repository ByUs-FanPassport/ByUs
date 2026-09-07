import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only",()=>({}));
import { CertificationImageError, MAX_CERTIFICATION_FILE_BYTES, normalizeCertificationImage } from "./certification-image";

describe("manual certification proof normalization",()=>{
  it("accepts JPEG and emits bounded metadata-free WebP",async()=>{
    const source=await sharp({create:{width:160,height:90,channels:3,background:"#ee3366"}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const normalized=await normalizeCertificationImage(new Uint8Array(source));
    const metadata=await sharp(normalized.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.orientation).toBeUndefined();
    expect(normalized.width).toBe(90);
    expect(normalized.height).toBe(160);
    expect(normalized.bytes.byteLength).toBeLessThanOrEqual(MAX_CERTIFICATION_FILE_BYTES);
  });
  it("rejects non-images and oversized requests",async()=>{
    await expect(normalizeCertificationImage(new TextEncoder().encode("not an image"))).rejects.toMatchObject({code:"INVALID_IMAGE"});
    await expect(normalizeCertificationImage(new Uint8Array(MAX_CERTIFICATION_FILE_BYTES+1))).rejects.toEqual(expect.objectContaining<Partial<CertificationImageError>>({code:"BODY_TOO_LARGE"}));
  });
});
