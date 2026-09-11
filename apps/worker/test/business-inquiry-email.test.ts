import { describe, expect, it } from "vitest";
import { inquirySubjectExcerpt, renderBusinessInquiryEmail } from "../src/business-inquiry-email.js";
import type { BusinessInquiry } from "../src/business-inquiry-worker.js";

const job: BusinessInquiry = {
  id: "11111111-1111-4111-8111-111111111111", attempt_token: "22222222-2222-4222-8222-222222222222",
  locale: "ko", contact_name: "김보석", company: "Sallylab", email: "sender@example.com", message: "팬 활동 상담하기",
};

describe("shared business inquiry email", () => {
  it.each([
    ["fanmeeting", "미국 팬미팅 문의"], ["creator", "팬 활동 문의"], ["partner", "파트너 협업 문의"],
  ] as const)("renders %s with a content excerpt and the same readable template", (inquiry_type, label) => {
    const result = renderBusinessInquiryEmail({ ...job, inquiry_type });
    expect(result.subject).toBe(`[ByUs ${label}] 팬 활동 상담하기`);
    for (const body of [result.text, result.html]) {
      for (const value of [label, job.contact_name, job.company, job.email, job.message, "문의 내용", "이 메일에 답장하면 문의자에게 전달됩니다."]) expect(body).toContain(value);
      expect(body).not.toContain(job.id);
      expect(body).not.toContain(job.attempt_token);
      expect(body).not.toContain("문의 번호");
      expect(body).not.toContain("언어: ko");
    }
    expect(result.html).toContain('max-width:600px');
    expect(result.html).not.toMatch(/<script|<link|<img/);
  });

  it("keeps the legacy default and original English text", () => {
    const message = "A fan meeting in New York\r\n\r\nPlease share available dates.\nThank you.";
    const result = renderBusinessInquiryEmail({ ...job, locale: "en", message });
    expect(result.subject).toMatch(/^\[ByUs 미국 팬미팅 문의\] A fan meeting in New York/);
    expect(result.text).toContain(message);
    expect(result.html).toContain('lang="en"');
    expect(result.html).toContain("New York<br><br>Please share available dates.<br>Thank you.");
  });

  it("escapes every submitted field without interpreting HTML or links", () => {
    const result = renderBusinessInquiryEmail({ ...job, contact_name: '<img src=x onerror="alert(1)">', company: "A&B's <team>", email: 'a"b@example.com', message: '<script>alert("x")</script>\n<a href="https://example.com">click</a>' });
    expect(result.html).not.toMatch(/<script|<img|<a href=/);
    expect(result.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(result.html).toContain("A&amp;B&#39;s &lt;team&gt;");
    expect(result.html).toContain("a&quot;b@example.com");
    expect(result.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>');
    expect(result.text).toContain('<script>alert("x")</script>');
  });

  it("normalizes subject whitespace and header controls without altering the body", () => {
    const message = "  협업\r\n\t제안\u0000\u202e 내용  ";
    const result = renderBusinessInquiryEmail({ ...job, message });
    expect(result.subject).toBe("[ByUs 미국 팬미팅 문의] 협업 제안 내용");
    expect(result.text).toContain(message);
  });

  it("bounds long subjects without splitting Korean or joined emoji and keeps the full body", () => {
    const message = "가👩‍👩‍👧‍👦".repeat(80);
    const result = renderBusinessInquiryEmail({ ...job, message });
    const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(inquirySubjectExcerpt(message)));
    expect(segments).toHaveLength(60);
    expect(segments.at(-1)?.segment).toBe("…");
    expect(segments.slice(0, -1).every(part => ["가", "👩‍👩‍👧‍👦"].includes(part.segment))).toBe(true);
    expect(result.text).toContain(message);
    expect(result.html).toContain(message);
  });

  it("keeps short excerpts intact and uses only the category for an empty message", () => {
    expect(inquirySubjectExcerpt("가".repeat(60))).toBe("가".repeat(60));
    expect(renderBusinessInquiryEmail({ ...job, message: "  \n " }).subject).toBe("[ByUs 미국 팬미팅 문의]");
  });
});
