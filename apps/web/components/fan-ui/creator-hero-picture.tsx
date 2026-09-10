import { getImageProps } from "next/image";
import type { CSSProperties } from "react";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import katseyeDesktop from "@/public/images/celebrities/katseye/hero-desktop.webp";
import katseyeMobile from "@/public/images/celebrities/katseye/hero-mobile.webp";
import { resolveCreatorHeroImage } from "./creator-image-config";
import { bypassImageOptimization } from "./public-image-policy";
import styles from "./creator-hero-picture.module.css";

/** Responsive creator banners keep their own composition while sharing registered sources. */
export function CreatorHeroPicture({ slug, image, className, priority = false }: {
  slug: string;
  image: PublishedCelebrity["image"];
  className?: string;
  priority?: boolean;
}) {
  const hero = resolveCreatorHeroImage(slug, image);
  const desktopSrc = slug === "katseye" ? katseyeDesktop : hero?.src ?? image.url;
  const mobileSrc = slug === "katseye" ? katseyeMobile : hero?.mobileSrc ?? desktopSrc;
  const desktop = getImageProps({ src: desktopSrc, alt: image.alt, fill: true, sizes: "(min-width: 1440px) 1360px, calc(100vw - 64px)", priority,
    unoptimized: typeof desktopSrc === "string" && bypassImageOptimization(desktopSrc) }).props;
  const mobileScale = hero?.mobileScale ?? 1;
  const mobile = getImageProps({ src: mobileSrc, alt: image.alt, fill: true, sizes: `calc(${100 * mobileScale}vw - ${32 * mobileScale}px)`, priority,
    unoptimized: typeof mobileSrc === "string" && bypassImageOptimization(mobileSrc) }).props;
  return <picture className={`${styles.picture} ${className ?? ""}`} data-creator-hero={slug}
    style={{ "--creator-banner-mobile-scale": mobileScale, "--creator-banner-mobile-origin": hero?.mobileOrigin ?? "50% 50%" } as CSSProperties}>
    <source media="(min-width: 48rem)" srcSet={desktop.srcSet ?? desktop.src} sizes={desktop.sizes} />
    <img {...mobile} alt={image.alt} />
  </picture>;
}
