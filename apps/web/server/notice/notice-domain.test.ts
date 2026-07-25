import { describe, expect, it } from "vitest";
import { parseNoticeDocument } from "./notice-domain";

describe("Notice rich-text contract", () => {
  it("accepts the supported Tiptap document set", () => {
    expect(parseNoticeDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "안내" }] },
        { type: "paragraph", content: [{ type: "text", text: "본문", marks: [{ type: "bold" }] }] },
        { type: "image", attrs: { src: "https://example.com/notice.webp", alt: "공지 대표 이미지" } },
      ],
    }).type).toBe("doc");
  });

  it.each([
    { type: "doc", content: [{ type: "paragraph" }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] },
    { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] },
    { type: "doc", content: [{ type: "codeBlock" }] },
    { type: "doc", content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "" } }] },
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "http://example.com" } }] }] }] },
  ])("rejects unsupported or unsafe rich text %#", (document) => {
    expect(() => parseNoticeDocument(document)).toThrow();
  });
});
