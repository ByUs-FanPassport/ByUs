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
  it("keeps WENA's mobile group photo tied to the approved landscape frame", () => {
    const landscape = binding("/wena-wide.jpg");
    landscape.frames["creator.hero.desktop"] = { fit: "cover", x: 45, y: 10, approvedAssetRevision: 1 };
    const image = { url: "/profile.jpg", position: "center", photos: { ...photos, landscape } };
    expect(resolveCreatorHeroImage("wena", image)).toMatchObject({ src: "/wena-wide.jpg", mobileSrc: "/wena-wide.jpg", mobileFit: "cover", mobilePosition: "45% 10%" });
    landscape.asset.revision = 2;
    expect(resolveCreatorHeroImage("wena", image)?.mobileFit).toBe("contain");
    expect(resolveCreatorHeroImage("wena", { ...image, photos: { ...photos, landscape: null } })?.mobileSrc).toBe("/profile.jpg");
  });
  it("does not revive a removed legacy portrait or carry profile zoom into another role", () => {
    expect(creatorCalendarPhotos("elina", "/profile.jpg", { portrait: null })).toEqual(["/profile.jpg"]);
    expect(resolveCreatorImage({ slug: "ifewknow", src: "/profile.jpg", presentation: "collection" }).crop).toMatchObject({ fit: "cover", scale: 1 });
    const jenny = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/celebrities/jenny-jeong/profile-a9daf680da1fe99b.jpg";
    expect(resolveCreatorHeroImage("jenny-jeong", { url: jenny, position: "50% 30%", photos: { landscape: null, portrait: null } })).toMatchObject({ src: jenny, mobileSrc: jenny, desktopFit: "contain", mobileFit: "contain", mobileScale: 1 });
  });
  it("selects independent event sources and contains a landscape fallback on mobile", () => {
    const view = render(<EventPhoto photos={photos} src="/poster.jpg" alt="LIVE" />);
    expect(view.container.querySelector("source")?.getAttribute("srcset")).toContain("landscape.jpg");
    expect(view.container.querySelector("img")?.getAttribute("srcset")).toContain("portrait.jpg");
    view.rerender(<EventPhoto photos={undefined} src="/poster.jpg" alt="LIVE" />);
    expect(view.container.querySelector("picture")?.style.getPropertyValue("--event-photo-mobile-fit")).toBe("contain");
  });

  it("exposes resolved breakpoint framing without treating unapproved crops as cover", () => {
    const landscape = binding("/wide.jpg");
    landscape.frames["event.home.desktop"] = { fit: "cover", x: 40, y: 30, approvedAssetRevision: 1 };
    const view = render(<EventPhoto photos={{ landscape }} src="/square.jpg" alt="LIVE" />);
    const picture = () => view.container.querySelector("picture");
    expect(picture()).toHaveAttribute("data-desktop-fit", "cover");
    expect(picture()).toHaveAttribute("data-mobile-fit", "contain");
    landscape.asset.revision = 2;
    view.rerender(<EventPhoto photos={{ landscape }} src="/square.jpg" alt="LIVE" />);
    expect(picture()).toHaveAttribute("data-desktop-fit", "contain");
    view.rerender(<EventPhoto photos={undefined} src="/square.jpg" alt="LIVE" surface="detail" />);
    expect(picture()).toHaveAttribute("data-desktop-fit", "contain");
    expect(picture()).toHaveAttribute("data-mobile-fit", "contain");
  });
});
