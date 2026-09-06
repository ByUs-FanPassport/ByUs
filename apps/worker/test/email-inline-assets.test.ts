import { describe, expect, it, vi } from "vitest";
import { emailInlineAssets } from "../src/email-inline-assets.js";

const image = new Uint8Array([255, 216, 255, 224]);
const origin = "https://byus.kr";
describe("email inline assets", () => {
  it("embeds a published JPEG and original PNG logo with matching CIDs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(image, {headers:{"content-type":"image/jpeg"}}));
    const result = await emailInlineAssets(`${origin}/images/poster.jpg`, {origin, fetcher});
    expect(result.posterContentId).toBe("byus-poster");
    expect(result.attachments.map(a => a.ContentId)).toEqual(["byus-logo", "byus-star", "byus-poster"]);
    expect(fetcher).toHaveBeenCalledWith(`${origin}/images/poster.jpg`, expect.objectContaining({redirect:"error",signal:expect.any(AbortSignal)}));
    expect(result.attachments[0]!.RawContent!.slice(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  });
  it("embeds the CMS pipeline's actual WebP poster format", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(Buffer.from("RIFF1234WEBPdata"), {headers:{"content-type":"image/webp"}}));
    const result = await emailInlineAssets(`${origin}/images/landscape-poster.webp`,{origin,fetcher});
    expect(result.attachments[2]).toMatchObject({ContentId:"byus-poster",ContentType:"image/webp",FileName:"live-poster.webp"});
  });
  it.each([
    "https://127.0.0.1/images/a.jpg", "https://evil.example/images/a.jpg", "http://byus.kr/images/a.jpg",
    "https://byus.kr/api/me", "https://byus.kr/images/a.jpg?redirect=evil", "https://u:p@byus.kr/images/a.jpg",
    "https://other.supabase.co/storage/v1/object/public/cms-assets/a.jpg",
    "https://own.supabase.co/storage/v1/object/authenticated/cms-assets/a.jpg",
  ])("never fetches unsafe or non-public URL %s", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    expect((await emailInlineAssets(url,{origin, storageOrigin:"https://own.supabase.co",fetcher})).attachments).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("permits only the configured project's public CMS storage", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(image,{headers:{"content-type":"image/jpeg"}}));
    expect((await emailInlineAssets("https://own.supabase.co/storage/v1/object/public/cms-assets/a.jpg",{origin,storageOrigin:"https://own.supabase.co",fetcher})).posterContentId).toBe("byus-poster");
  });
  it.each(["redirect", "timeout", "http", "type", "magic", "declared-size", "stream-size"])("falls back without an email retry on %s", async (failure) => {
    const fetcher = vi.fn<typeof fetch>();
    if (["redirect","timeout"].includes(failure)) fetcher.mockRejectedValue(new Error(failure));
    else fetcher.mockResolvedValue(new Response(failure === "stream-size" ? new Uint8Array(3*1024*1024+1) : failure === "magic" ? "html" : image, {
      status:failure === "http" ? 404 : 200,
      headers:{"content-type":failure === "type" ? "text/html" : "image/jpeg",...(failure === "declared-size" ? {"content-length":"9999999"} : {})},
    }));
    const result=await emailInlineAssets(`${origin}/images/a.jpg`,{origin,fetcher});
    expect(result.attachments).toHaveLength(2);
    expect(result.posterContentId).toBeUndefined();
  });
});
