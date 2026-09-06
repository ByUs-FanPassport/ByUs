import type { Attachment } from "@aws-sdk/client-sesv2";
import { EMAIL_STAR } from "./email-star.js";
import { EMAIL_LOGO } from "./email-logo.js";

const MAX_POSTER_BYTES = 3 * 1024 * 1024;

export async function emailInlineAssets(
  imageUrl: string | undefined,
  config: { origin: string; storageOrigin?: string | undefined; fetcher?: typeof fetch | undefined },
): Promise<{ attachments: Attachment[]; posterContentId?: string }> {
  const attachments: Attachment[] = [{
    RawContent: EMAIL_LOGO, FileName: "byus-logo.png", ContentType: "image/png",
    ContentDisposition: "INLINE", ContentId: "byus-logo", ContentTransferEncoding: "BASE64",
  }, {
    RawContent: EMAIL_STAR, FileName: "byus-star.png", ContentType: "image/png",
    ContentDisposition: "INLINE", ContentId: "byus-star", ContentTransferEncoding: "BASE64",
  }];
  if (!imageUrl) return { attachments };
  // Fetch only our static images or the configured project's public CMS bucket.
  // No arbitrary hosts, credentials, query strings or redirects (SSRF boundary).
  try {
    const url = new URL(imageUrl);
    const allowed = (url.origin === config.origin && url.pathname.startsWith("/images/")) ||
      (url.origin === config.storageOrigin && url.pathname.startsWith("/storage/v1/object/public/cms-assets/"));
    if (!allowed || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return { attachments };
    const response = await (config.fetcher ?? fetch)(url.href, {
      redirect: "error", signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok || !response.body) return { attachments };
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (!["image/jpeg", "image/png", "image/webp"].includes(type ?? "") || declaredSize > MAX_POSTER_BYTES) {
      await response.body.cancel();
      return { attachments };
    }
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_POSTER_BYTES) {
          await reader.cancel();
          return { attachments };
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = Buffer.concat(chunks);
    const jpeg = type === "image/jpeg" && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    const png = type === "image/png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = type === "image/webp" && data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
    if (!jpeg && !png && !webp) return { attachments };
    attachments.push({
      RawContent: data, FileName: png ? "live-poster.png" : webp ? "live-poster.webp" : "live-poster.jpg", ContentType: type!,
      ContentDisposition: "INLINE", ContentId: "byus-poster", ContentTransferEncoding: "BASE64",
    });
    return { attachments, posterContentId: "byus-poster" };
  } catch {
    // Artwork failure must not delay or retry an otherwise deliverable notification.
    return { attachments };
  }
}
