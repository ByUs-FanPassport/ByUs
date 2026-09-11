import { getImageProps } from "next/image";
import type { CSSProperties } from "react";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { resolveCreatorHeroImage } from "./creator-image-config";
import { bypassImageOptimization } from "./public-image-policy";
import styles from "./creator-hero-picture.module.css";

/** Responsive creator banners keep their own composition while sharing registered sources. */
export function CreatorHeroPicture({ slug, image, locale = "ko", className, priority = false }: {
  slug: string;
  image: PublishedCelebrity["image"];
  locale?: "ko" | "en";
  className?: string;
  priority?: boolean;
}) {
  const hero = resolveCreatorHeroImage(slug, image);
  const desktopSrc = hero?.src ?? image.url;
  const mobileSrc = hero?.mobileSrc ?? desktopSrc;
  const desktopAlt = image.photos?.landscape?.alt[locale] ?? image.alt;
  const mobileAlt = image.photos?.portrait?.alt[locale] ?? image.alt;
  const desktop = getImageProps({ src: desktopSrc, alt: desktopAlt, fill: true, sizes: "(min-width: 1440px) 940px, (min-width: 768px) calc(69vw - 44px), calc(100vw - 32px)", priority,
    unoptimized: typeof desktopSrc === "string" && bypassImageOptimization(desktopSrc) }).props;
  const mobileScale = hero?.mobileScale ?? 1;
  const mobile = getImageProps({ src: mobileSrc, alt: mobileAlt, fill: true, sizes: `calc(${100 * mobileScale}vw - ${32 * mobileScale}px)`, priority,
    unoptimized: typeof mobileSrc === "string" && bypassImageOptimization(mobileSrc) }).props;
  return <picture className={`${styles.picture} ${className ?? ""}`} data-creator-hero={slug}
    style={{ "--creator-banner-desktop-fit": hero?.desktopFit ?? "contain", "--creator-banner-mobile-fit": hero?.mobileFit ?? "contain", "--creator-banner-desktop-position": hero?.desktopPosition, "--creator-banner-mobile-position": hero?.mobilePosition, "--creator-banner-mobile-scale": mobileScale, "--creator-banner-mobile-origin": hero?.mobileOrigin ?? "50% 50%" } as CSSProperties}>
    <source media="(min-width: 48rem)" srcSet={desktop.srcSet ?? desktop.src} sizes={desktop.sizes} />
    <img {...mobile} alt={mobileAlt} />
  </picture>;
}
