import { describe, expect, it } from "vitest";
import { bypassImageOptimization, creatorCropScale, homeHeroSizes, publicImageRemotePatterns } from "./public-image-policy";

describe("public image delivery boundary", () => {
  const host = "https://gmrykvmtmuaeswpajteq.supabase.co";
  it("optimizes only local assets and the exact public CMS buckets", () => {
    expect(bypassImageOptimization("/images/profile.webp")).toBe(false);
    for (const pattern of publicImageRemotePatterns) {
      expect(bypassImageOptimization(`https://${pattern.hostname}/storage/v1/object/public/cms-assets/celebrities/xin/image.jpg`)).toBe(false);
      expect(pattern.search).toBe("");
    }
    for (const source of [
      `${host}/storage/v1/object/sign/fan-avatars/photo.webp?token=private`,
      `${host}/storage/v1/object/public/fan-avatars/photo.webp`,
      `${host}/storage/v1/object/public/cms-assets/image.jpg?token=private`,
      "https://other.example/image.jpg",
      "https://gmrykvmtmuaeswpajteq.supabase.co.evil.example/storage/v1/object/public/cms-assets/image.jpg",
      "https://user:pass@gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/image.jpg",
    ]) expect(bypassImageOptimization(source)).toBe(true);
  });

  it("accounts for existing crop magnification without multiplying by device DPR", () => {
    expect(creatorCropScale("xin")).toBe(1.6);
    expect(creatorCropScale("park-myungho")).toBe(1.9);
    expect(creatorCropScale("ifewknow")).toBe(2.45);
    expect(creatorCropScale("jenny-jeong")).toBe(1);
    expect(homeHeroSizes(true)).toContain("952px");
    expect(homeHeroSizes(false)).toContain("1360px");
  });
});
