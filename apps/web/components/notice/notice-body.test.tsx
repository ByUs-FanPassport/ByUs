import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeBody } from "./notice-body";

describe("NoticeBody", () => {
  it("renders approved Tiptap JSON without HTML injection and announces external links", () => {
    render(
      <NoticeBody
        locale="ko"
        document={{
          type: "doc",
          content: [{
            type: "paragraph",
            content: [{
              type: "text",
              text: "공식 채널",
              marks: [{ type: "link", attrs: { href: "https://example.com/news" } }],
            }],
          }],
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "공식 채널, 새 창" })).toHaveAttribute(
      "href",
      "https://example.com/news",
    );
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
  });
});
