import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatorImage } from "./creator-image";
import { creatorCalendarPhotos, creatorImageSizes, parkMyunghoProfile, resolveCreatorHeroImage, resolveCreatorImage, type CreatorImagePresentation } from "./creator-image-config";

const previous = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/celebrities/park-myungho/profile-dcc87957756c27df.jpg";

describe("shared creator photography", () => {
  it("uses the approved source across all identity presentations without overriding a later CMS replacement", () => {
    for (const presentation of ["portrait", "avatar", "passport", "collection", "vertical", "calendar"] as CreatorImagePresentation[]) {
      if (["portrait", "avatar", "passport"].includes(presentation)) expect(resolveCreatorImage({ slug: "park-myungho", src: previous, presentation }).src).toBe(parkMyunghoProfile);
      const replacement = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/celebrities/park-myungho/new-photo.jpg";
      expect(resolveCreatorImage({ slug: "park-myungho", src: replacement, position: "50% 32%", presentation })).toMatchObject({ src: replacement, crop: { scale: 1, position: "50% 32%" } });
    }
  });

  it("preserves group-specific sources and framing for square and circular surfaces", () => {
    expect(resolveCreatorImage({ slug: "xin", src: "/group.jpg" }).crop).toMatchObject({ scale: 1.6, position: "50% 100%" });
    expect(resolveCreatorImage({ slug: "xin", src: "/group.jpg", presentation: "avatar" })).toMatchObject({ src: "/images/celebrities/xin/hero-concept-mobile.jpg", crop: { scale: 1 } });
  });

  it("keeps the banner in sync with an approved photo or a later CMS replacement", () => {
    expect(resolveCreatorHeroImage("park-myungho", { url: previous, position: "center" })?.src).toBe(parkMyunghoProfile);
    expect(resolveCreatorHeroImage("park-myungho", { url: "/new-profile.jpg", position: "50% 32%" })).toMatchObject({ src: "/new-profile.jpg", desktopPosition: "50% 32%", mobilePosition: "50% 32%" });
  });

  it("scales source sizes while preserving breakpoint conditions and calc geometry", () => {
    expect(creatorImageSizes("(min-width: 768px) 64px, 24px", 2.3)).toBe("(min-width: 768px) 147.2px, 55.2px");
    expect(creatorImageSizes("(min-width: 1440px) 438px, calc(100vw - 32px)", 2.3)).toBe("(min-width: 1440px) 1007.4px, calc(230vw - 73.6px)");
  });

  it("uses Jenny's CMS replacement in the banner and calendar instead of her previous dedicated photos", () => {
    const oldPhoto = "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/celebrities/jenny-jeong/profile-88d6cd4994afe602.jpg";
    const replacement = oldPhoto.replace("profile-88d6cd4994afe602.jpg", "new-profile.jpg");
    expect(resolveCreatorHeroImage("jenny-jeong", { url: oldPhoto, position: "center" })?.src).toBe("/images/celebrities/jenny-jeong/hero-source.jpg");
    expect(resolveCreatorHeroImage("jenny-jeong", { url: replacement, position: "50% 30%" })).toMatchObject({ src: replacement, desktopPosition: "50% 30%", mobilePosition: "50% 30%" });
    expect(creatorCalendarPhotos("jenny-jeong", replacement)).toEqual([replacement]);
  });

  it("owns the clipping frame and recovers from a failed source when the source changes", () => {
    const { container, rerender } = render(<CreatorImage slug="elina" src="/first.jpg" alt="Elina" width={48} height={48} sizes="48px" framed fallback={<span>Image unavailable</span>} />);
    expect(container.firstElementChild).toHaveAttribute("data-creator-image-frame", "elina");
    fireEvent.error(screen.getByRole("img", { name: "Elina" }));
    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-creator-image-frame", "elina");
    rerender(<CreatorImage slug="elina" src="/second.jpg" alt="Elina" width={48} height={48} sizes="48px" framed />);
    expect(screen.getByRole("img", { name: "Elina" })).toBeInTheDocument();
  });
});
