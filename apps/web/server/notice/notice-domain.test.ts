import { describe, expect, it } from "vitest";
import { parseNoticeDocument, parseNoticeLocaleParams } from "./notice-domain";

describe("Notice locale query", () => {
  it("defaults to Korean and rejects invalid or duplicate values", () => {
    expect(parseNoticeLocaleParams(new URLSearchParams())).toBe("ko");
    expect(parseNoticeLocaleParams(new URLSearchParams("locale=en"))).toBe("en");
    expect(parseNoticeLocaleParams(new URLSearchParams("locale=fr"))).toBeNull();
    expect(parseNoticeLocaleParams(new URLSearchParams("locale=ko&locale=en"))).toBeNull();
  });
});

describe("Notice rich-text contract", () => {
  it("validates unsafe siblings after a meaningful first paragraph", () => {
    expect(() => parseNoticeDocument({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "valid" }] },
      { type: "image", attrs: { src: "javascript:alert(1)", alt: "image" } },
    ] })).toThrow();
    expect(() => parseNoticeDocument({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "valid" }, { type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "http://unsafe.test" } }] },
    ] }] })).toThrow();
  });
  it("accepts only canonical protected image paths", () => {
    const doc = (src: string) => ({ type: "doc", content: [{ type: "image", attrs: { src, alt: "photo" } }] });
    expect(parseNoticeDocument(doc("/api/content-assets/11111111-1111-4111-8111-111111111111"))).toBeTruthy();
    expect(() => parseNoticeDocument(doc("/api/content-assets/../secret"))).toThrow();
  });
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
