import Image from "next/image";
import { bypassImageOptimization, creatorCropScale } from "./public-image-policy";
import type { PublishedCelebrity } from "../../server/content/content-domain";
import styles from "./creator-portrait.module.css";

/** Square card crops only. Banner and circular avatar crops have separate rules. */
export function CreatorPortrait({ slug, image, variant = "inset" }: {
  slug: string;
  image: PublishedCelebrity["image"];
  variant?: "inset" | "full-bleed";
}) {
  const position = slug === "park-myungho" ? "50% 0%"
    : slug === "xin" ? "50% 100%"
    : slug === "yuna" ? "50% 20%"
    : image.position;

  const scale = creatorCropScale(slug);
  const sizes = variant === "full-bleed"
    ? `(min-width: 1440px) ${438 * scale}px, (min-width: 1024px) calc(${100 / 3 * scale}vw - ${112 / 3 * scale}px), (min-width: 768px) calc(${50 * scale}vw - ${44 * scale}px), calc(${100 * scale}vw - ${32 * scale}px)`
    : `${240 * scale}px`;

  return (
    <span className={styles.portrait} data-portrait={slug} data-variant={variant}>
      <Image src={image.url} alt={image.alt} width={420} height={420} sizes={sizes}
        style={{ objectPosition: position }} unoptimized={bypassImageOptimization(image.url)} />
    </span>
  );
}
