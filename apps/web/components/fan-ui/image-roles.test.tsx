import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolvePhoto, type PhotoBinding, type PhotoSet } from "@/features/media/domain/public-image";
import { resolveCreatorImage, resolveCreatorHeroImage, creatorCalendarPhotos } from "./creator-image-config";
import { EventPhoto } from "./event-photo";
const binding = (url: string): PhotoBinding => ({ asset: { id: "asset", url, width: 1600, height: 1800, mimeType: "image/webp", revision: 1 }, alt: { ko: "사진", en: "Photo" }, frames: {}, revision: 1 });

describe("independent image roles", () => {
  const photos: PhotoSet = { profile: binding("/profile.jpg"), portrait: binding("/portrait.jpg"), landscape: binding("/landscape.jpg") };
  it("routes slots by purpose including mobile landscape collection", () => {
    expect(resolveCreatorImage({ slug: "xin", src: "/old.jpg", photos, presentation: "avatar" }).src).toBe("/profile.jpg");
    expect(resolveCreatorImage({ slug: "xin", src: "/old.jpg", photos, presentation: "vertical" }).src).toBe("/portrait.jpg");
    expect(resolveCreatorImage({ slug: "xin", src: "/old.jpg", photos, presentation: "collection" }).src).toBe("/landscape.jpg");
    expect(resolveCreatorHeroImage("jenny-jeong", { url: "/old.jpg", position: "center", photos })).toMatchObject({ src: "/landscape.jpg", mobileSrc: "/portrait.jpg" });
    expect(resolveCreatorHeroImage("jenny-jeong", { url: "/old.jpg", position: "center", photos: { ...photos, profile: binding("/new-profile.jpg") } })).toMatchObject({ src: "/landscape.jpg", mobileSrc: "/portrait.jpg" });
  });
  it("requires a matching asset revision before cover", () => {
    const photo = binding("/portrait.jpg");
    photo.frames["creator.hero.mobile"] = { fit: "cover", x: 35, y: 25, approvedAssetRevision: 1 };
    expect(resolvePhoto({ portrait: photo }, "creator.hero.mobile", "/old.jpg")).toMatchObject({ fit: "cover", position: "35% 25%" });
    photo.asset.revision = 2;
    expect(resolvePhoto({ portrait: photo }, "creator.hero.mobile", "/old.jpg").fit).toBe("contain");
  });
  it("does not revive a removed legacy portrait or carry profile zoom into another role", () => {
    expect(creatorCalendarPhotos("elina", "/profile.jpg", { portrait: null })).toEqual(["/profile.jpg"]);
    expect(resolveCreatorImage({ slug: "ifewknow", src: "/profile.jpg", presentation: "collection" }).crop).toMatchObject({ fit: "cover", scale: 1 });
    const jenny = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/celebrities/jenny-jeong/profile-a9daf680da1fe99b.jpg";
    expect(resolveCreatorHeroImage("jenny-jeong", { url: jenny, position: "50% 30%" })).toMatchObject({ src: jenny, desktopFit: "contain", mobileFit: "contain", mobileScale: 1 });
  });
  it("selects independent event sources and contains a landscape fallback on mobile", () => {
    const view = render(<EventPhoto photos={photos} src="/poster.jpg" alt="LIVE" />);
    expect(view.container.querySelector("source")?.getAttribute("srcset")).toContain("landscape.jpg");
    expect(view.container.querySelector("img")?.getAttribute("srcset")).toContain("portrait.jpg");
    view.rerender(<EventPhoto photos={undefined} src="/poster.jpg" alt="LIVE" />);
    expect(view.container.querySelector("picture")?.style.getPropertyValue("--event-photo-mobile-fit")).toBe("contain");
  });
});
