"use client";

import type { PhotoSet } from "@/features/media/domain/public-image";
import { CreatorImage } from "./creator-image";
import { type CSSProperties } from "react";
import styles from "./creator-avatar.module.css";

type AvatarSize = number | Readonly<{ mobile: number; desktop: number }>;

/** Creator identity imagery. Size is the only presentation option; crops live here. */
export function CreatorAvatar({ slug, src, size, photos, position, alt = "" }: {
  slug: string;
  src: string | null | undefined;
  size: AvatarSize;
  alt?: string;
  photos?: PhotoSet;
  position?: string;
}) {
  const mobile = typeof size === "number" ? size : size.mobile;
  const desktop = typeof size === "number" ? size : size.desktop;
  return <span className={styles.avatar} data-creator-avatar={slug} style={{ "--avatar-size": `${mobile}px`, "--avatar-desktop-size": `${desktop}px` } as CSSProperties}>
    <CreatorImage slug={slug} src={src} photos={photos} position={position} presentation="avatar" alt={alt}
      width={Math.max(mobile, desktop) * 2} height={Math.max(mobile, desktop) * 2}
      sizes={`(min-width: 768px) ${desktop}px, ${mobile}px`}
      fallback={<svg viewBox="0 0 24 24" role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={!alt || undefined}><circle cx="12" cy="8" r="4" /><path d="M4 23v-3a8 8 0 0 1 16 0v3" /></svg>} />
  </span>;
}
