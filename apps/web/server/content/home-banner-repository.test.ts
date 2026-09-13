import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHomeBannerRepository } from "./home-banner-repository";

const asset = { id: "11111111-1111-4111-8111-111111111111", url: "https://cdn.test/banner.webp", width: 1440, height: 640, mimeType: "image/webp", revision: 1 };
const valid = { id: "22222222-2222-4222-8222-222222222222", kind: "announcement", celebrityId: null, title: "Title", description: "", ctaLabel: "Open", href: "/calendar?tab=live#next", alt: "Banner", desktopImage: asset, mobileImage: null };

describe("home banner public repository", () => {
  it("requests one locale and skips an invalid public DTO without cross-locale fallback", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [valid, { ...valid, id: "bad", title: "" }], error: null });
    const rows = await createHomeBannerRepository({ url: "http://local", serviceRoleKey: "key" }, { rpc } as never).list("en");
    expect(rpc).toHaveBeenCalledWith("read_published_home_banners", { p_locale: "en" });
    expect(rows).toEqual([valid]);
  });
  it("fails explicitly when the RPC is missing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(createHomeBannerRepository({ url: "http://local", serviceRoleKey: "key" }, { rpc } as never).list("ko"))
      .rejects.toThrow("HOME_BANNER_READ_FAILED");
  });
});
