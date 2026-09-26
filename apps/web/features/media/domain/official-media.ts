import { z } from "zod";
import { parseNoticeDocument, isPrivateNoticeImage } from "@/server/notice/notice-domain";
import { isRecordedReplayUrl } from "@/features/live/domain/live-watch-link";
import { assetSchema, noticeSchema } from "@/features/fan-posts/domain/content";
export const officialMediaSchema = z.object({ id: z.string(), kind: z.enum(["photos", "videos"]), title: z.string(), image: z.string().nullable(), asset: assetSchema.nullable(), href: z.string(), date: z.string() });
export type OfficialMedia = z.infer<typeof officialMediaSchema>;
export const officialMediaPageSchema = z.object({ items: z.array(officialMediaSchema), nextCursor: z.string().nullable() });
export function noticeMedia(notice: z.infer<typeof noticeSchema>, creatorSlug: string): OfficialMedia[] {
  const document = parseNoticeDocument(notice.body), items: OfficialMedia[] = [], seen = new Set<string>();
  const detail = `/c/${encodeURIComponent(creatorSlug)}/notices/${encodeURIComponent(notice.slug)}`;
  function visit(node: Record<string, unknown>) {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (node.type === "image" && typeof attrs?.src === "string" && !seen.has(attrs.src)) {
      seen.add(attrs.src);
      const privateImage = isPrivateNoticeImage(attrs.src);
      items.push({ id: `notice:${notice.id}:${items.length}`, kind: "photos", title: String(attrs.alt || notice.title), image: privateImage ? null : attrs.src, asset: privateImage ? { id: attrs.src.split("/").at(-1)!, width: typeof attrs.width === "number" && attrs.width > 0 ? attrs.width : 960, height: typeof attrs.height === "number" && attrs.height > 0 ? attrs.height : 640 } : null, href: detail, date: notice.publishedAt });
    }
    if (Array.isArray(node.marks)) for (const value of node.marks) {
      const mark = value as { type?: string; attrs?: { href?: unknown } }, href = mark.attrs?.href;
      if (mark.type === "link" && typeof href === "string" && !seen.has(href) && ["youtube", "instagram", "tiktok", "chzzk"].some(provider => isRecordedReplayUrl(provider, href))) {
        seen.add(href); items.push({ id: `notice:${notice.id}:${items.length}`, kind: "videos", title: String(node.text || notice.title), image: null, asset: null, href, date: notice.publishedAt });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(child => visit(child as Record<string, unknown>));
  }
  document.content.forEach(visit);
  return items;
}
