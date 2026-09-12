import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatorImage } from "./creator-image";
import { creatorPresentationSlots } from "./creator-image-config";
import { imageSlots, type PhotoBinding, type PhotoSet } from "@/features/media/domain/public-image";
import { HomeEntryCards } from "../home-entry-cards/home-entry-cards";
import { FanParticipationGuide } from "../fan-participation-guide/fan-participation-guide";
import type { PublishedCelebrity } from "@/server/content/content-domain";
const binding = (role: string, revision = 1): PhotoBinding => ({ asset: { id: role, url: `/roles/${role}-${revision}.jpg`, width: 1800, height: 1800, mimeType: "image/jpeg", revision }, alt: { ko: role, en: role }, frames: {}, revision });
const photoSet = (revision = 1): PhotoSet => Object.fromEntries(["profile", "portrait", "landscape", "poster"].map(role => [role, binding(role, revision)]));
const celebrity = (revision = 1): PublishedCelebrity => ({ slug: "elina", locale: "ko", name: "Elina", summary: "", image: { url: "/legacy.jpg", alt: "Elina", position: "center", photos: photoSet(revision) }, roles: ["creator"], themes: [], socialLinks: [], displayOrder: 0, fanCount: 1 });
const expectImage = (node: Element | null, source: string) => expect(`${node?.getAttribute("src")} ${node?.getAttribute("srcset")}`).toContain(encodeURIComponent(source));

describe("role propagation from parent content", () => {
  it.each(Object.entries(creatorPresentationSlots))("keeps %s bound to its declared role across updates", (presentation, slot) => {
    const props = { slug: "elina", src: "/legacy.jpg", alt: "Creator", width: 64, height: 64, sizes: "64px", presentation: presentation as keyof typeof creatorPresentationSlots };
    const view = render(<CreatorImage {...props} photos={photoSet()} />);
    expectImage(view.container.querySelector("img"), `/roles/${imageSlots[slot].role}-1.jpg`);
    view.rerender(<CreatorImage {...props} photos={photoSet(2)} />);
    expectImage(view.container.querySelector("img"), `/roles/${imageSlots[slot].role}-2.jpg`);
  });
  it("keeps the selected Elina guide portrait without the retired event poster", () => {
    const view = render(<HomeEntryCards locale="ko" celebrities={[celebrity()]} />);
    expectImage(view.container.querySelector('[data-creator-image="elina"]'), "/images/celebrities/elina/guide-blue-beret-20260912.webp");
    expect(view.container.querySelector('[data-event-photo="poster"]')).toBeNull();
    view.rerender(<HomeEntryCards locale="ko" celebrities={[celebrity(2)]} />);
    expectImage(view.container.querySelector('[data-creator-image="elina"]'), "/images/celebrities/elina/guide-blue-beret-20260912.webp");
    expect(view.container.querySelector('[data-event-photo="poster"]')).toBeNull();
  });
  it.each(["elina", "ifew"] as const)("keeps %s guide identity separate from editorial imagery", creator => {
    const view = render(<FanParticipationGuide locale="ko" creator={creator} images={{ celebrity: celebrity(), eventPhotos: photoSet() }} />);
    expectImage(view.container.querySelector('[data-creator-avatar] img'), "/roles/profile-1.jpg");
    if (creator === "elina") expectImage(view.container.querySelector('[data-image-presentation="editorial"]'), "/roles/portrait-1.jpg");
    else expectImage(view.container.querySelector('[data-event-photo="poster"] img'), "/roles/poster-1.jpg");
    view.rerender(<FanParticipationGuide locale="ko" creator={creator} images={{ celebrity: celebrity(2), eventPhotos: photoSet(2) }} />);
    expectImage(view.container.querySelector('[data-creator-avatar] img'), "/roles/profile-2.jpg");
  });
});
