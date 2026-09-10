import { CreatorImage } from "./creator-image";
import type { PublishedCelebrity } from "../../server/content/content-domain";
import styles from "./creator-portrait.module.css";

/** Square card crops only. Banner and circular avatar crops have separate rules. */
export function CreatorPortrait({ slug, image, variant = "inset" }: {
  slug: string;
  image: PublishedCelebrity["image"];
  variant?: "inset" | "full-bleed";
}) {
  const sizes = variant === "full-bleed"
    ? "(min-width: 1440px) 438px, (min-width: 1024px) calc(33.333vw - 37.333px), (min-width: 768px) calc(50vw - 44px), calc(100vw - 32px)"
    : "240px";

  return (
    <span className={styles.portrait} data-portrait={slug} data-variant={variant}>
      <CreatorImage slug={slug} src={image.url} alt={image.alt} width={420} height={420} sizes={sizes} position={image.position} />
    </span>
  );
}
