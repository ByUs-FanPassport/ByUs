import { z } from "zod";

export const noticeLocaleSchema = z.enum(["ko", "en"]);
export type NoticeLocale = z.infer<typeof noticeLocaleSchema>;

export type TiptapDocument = Readonly<{
  type: "doc";
  content: readonly Record<string, unknown>[];
}>;

const allowedNodes = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "image",
  "text",
  "hardBreak",
]);
const allowedMarks = new Set(["bold", "italic", "underline", "link"]);

function safeHttps(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateNode(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 30) {
    throw new Error("Invalid Notice document");
  }
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string" || !allowedNodes.has(node.type)) {
    throw new Error("Unsupported Notice node");
  }
  if (node.type === "heading") {
    const level = (node.attrs as Record<string, unknown> | undefined)?.level;
    if (level !== 2 && level !== 3) throw new Error("Only H2 and H3 are allowed");
  }
  if (node.type === "image") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!safeHttps(attrs?.src) || typeof attrs?.alt !== "string" || !attrs.alt.trim()) {
      throw new Error("Notice images require an HTTPS source and alt text");
    }
  }
  if (Array.isArray(node.marks)) {
    for (const markValue of node.marks) {
      if (!markValue || typeof markValue !== "object") throw new Error("Invalid Notice mark");
      const mark = markValue as Record<string, unknown>;
      if (typeof mark.type !== "string" || !allowedMarks.has(mark.type)) throw new Error("Unsupported Notice mark");
      if (mark.type === "link" && !safeHttps((mark.attrs as Record<string, unknown> | undefined)?.href)) {
        throw new Error("Notice links must use HTTPS");
      }
    }
  }
  let meaningful = node.type === "image";
  if (node.type === "text" && typeof node.text === "string" && node.text.trim()) {
    meaningful = true;
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new Error("Invalid Notice content");
    meaningful = node.content.some((child) => validateNode(child, depth + 1)) || meaningful;
  }
  return meaningful;
}

export function parseNoticeDocument(value: unknown): TiptapDocument {
  const meaningful = validateNode(value);
  const document = value as Record<string, unknown>;
  if (document.type !== "doc" || !Array.isArray(document.content) || !meaningful) {
    throw new Error("Notice body is required");
  }
  return value as TiptapDocument;
}

export const noticeSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export type PublicNoticeSummary = Readonly<{
  slug: string;
  title: string;
  pinned: boolean;
  publishedAt: string;
}>;

export type PublicNoticeDetail = PublicNoticeSummary &
  Readonly<{ body: TiptapDocument }>;
