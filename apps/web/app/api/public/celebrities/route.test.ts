import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGetPublishedCelebrities } from "./route";

const celebrity = {
  slug: "kara",
  locale: "ko" as const,
  name: "KARA",
  summary: "공개 소개",
  image: { url: "/kara.jpg", alt: "KARA", position: "center" },
  themes: [],
  socialLinks: [],
};

describe("GET /api/public/celebrities", () => {
  it("returns only the public DTO for the requested locale", async () => {
    const list = vi.fn().mockResolvedValue([celebrity]);
    const response = await createGetPublishedCelebrities({ list })(
      new Request("https://byus.kr/api/public/celebrities?locale=ko"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate, s-maxage=60, stale-while-revalidate=300",
    );
    expect(response.headers.get("vercel-cache-tag")).toBe(
      "byus-public-content",
    );
    expect(await response.json()).toEqual({ celebrities: [celebrity] });
    expect(list).toHaveBeenCalledWith("ko");
  });

  it("rejects an unsupported locale without querying content", async () => {
    const list = vi.fn();
    const response = await createGetPublishedCelebrities({ list })(
      new Request("https://byus.kr/api/public/celebrities?locale=ja"),
    );
    expect(response.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("fails closed without leaking repository details", async () => {
    const list = vi.fn().mockRejectedValue(new Error("service role key abc"));
    const response = await createGetPublishedCelebrities({ list })(
      new Request("https://byus.kr/api/public/celebrities"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "content_unavailable" });
  });
});
