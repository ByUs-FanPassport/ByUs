import Image from "next/image";
import { bypassImageOptimization, creatorCropScale } from "./public-image-policy";
import type { PublishedCelebrity } from "../../server/content/content-domain";
import styles from "./creator-portrait.module.css";

/** Square card crops only. Banner and circular avatar crops have separate rules. */
export function CreatorPortrait({ slug, image }: {
  slug: string;
  image: PublishedCelebrity["image"];
}) {
  const position = slug === "park-myungho" ? "50% 0%"
    : slug === "xin" ? "50% 100%"
    : slug === "yuna" ? "50% 20%"
    : image.position;

  return (
    <span className={styles.portrait} data-portrait={slug}>
      <Image src={image.url} alt={image.alt} width={420} height={420} sizes={`${240 * creatorCropScale(slug)}px`}
        style={{ objectPosition: position }} unoptimized={bypassImageOptimization(image.url)} />
    </span>
  );
}
