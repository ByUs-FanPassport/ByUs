import { getImageProps } from "next/image";
import type { CSSProperties } from "react";
import { resolvePhoto, type PhotoSet, type ImageSlot } from "@/features/media/domain/public-image";
import { bypassImageOptimization } from "./public-image-policy";
import styles from "./event-photo.module.css";

/** Event photography is independent from creator identity. Missing roles retain the whole supplied image. */
export function EventPhoto({ photos, src, alt, locale = "ko", surface = "home", priority = false, sizes }: {
  photos?: PhotoSet; src: string; alt: string; locale?: "ko" | "en"; surface?: "home" | "detail" | "poster"; priority?: boolean; sizes?: string;
}) {
  const desktopSlot: ImageSlot = surface === "home" ? "event.home.desktop" : surface === "poster" ? "event.poster" : "event.detail";
  const desktop = resolvePhoto(photos, desktopSlot, src, locale);
  const mobile = resolvePhoto(photos, surface === "home" ? "event.home.mobile" : desktopSlot, src, locale);
  const props = (photo: typeof desktop, imageSizes: string) => getImageProps({ src: photo.src, alt: photo.alt ?? alt, fill: true, sizes: imageSizes, priority, loading: priority ? "eager" : "lazy", fetchPriority: priority ? "high" : "auto", unoptimized: bypassImageOptimization(photo.src) }).props;
  const desktopProps = props(desktop, sizes ?? "(min-width: 1440px) 1360px, calc(100vw - 64px)");
  const mobileProps = props(mobile, "calc(100vw - 32px)");
  return <picture className={styles.picture} data-event-photo={surface} style={{
    "--event-photo-desktop-fit": desktop.fit, "--event-photo-mobile-fit": mobile.fit,
    "--event-photo-desktop-position": desktop.position, "--event-photo-mobile-position": surface === "home" && mobile.fallback ? "50% 0%" : mobile.position,
  } as CSSProperties}>
    <source media="(min-width: 48rem)" srcSet={desktopProps.srcSet ?? desktopProps.src} sizes={desktopProps.sizes} />
    <img {...mobileProps} alt={mobile.alt ?? alt} />
  </picture>;
}
