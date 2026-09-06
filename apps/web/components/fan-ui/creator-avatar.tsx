"use client";

import Image from "next/image";
import { bypassImageOptimization, creatorCropScale } from "./public-image-policy";
import { useState, type CSSProperties } from "react";
import styles from "./creator-avatar.module.css";

type AvatarSize = number | Readonly<{ mobile: number; desktop: number }>;

/** Creator identity imagery. Size is the only presentation option; crops live here. */
export function CreatorAvatar({ slug, src, size, alt = "" }: {
  slug: string;
  src: string | null | undefined;
  size: AvatarSize;
  alt?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const source = slug === "katseye" ? "/images/celebrities/katseye/profile.webp"
    : slug === "xin" ? "/images/celebrities/xin/hero-concept-mobile.jpg" : src;
  const mobile = typeof size === "number" ? size : size.mobile;
  const desktop = typeof size === "number" ? size : size.desktop;
  const available = Boolean(source && source !== failedSrc);
  return <span className={styles.avatar} data-creator-avatar={slug} style={{ "--avatar-size": `${mobile}px`, "--avatar-desktop-size": `${desktop}px` } as CSSProperties}>
    {available ? <Image src={source!} alt={alt} width={Math.max(mobile, desktop) * 2} height={Math.max(mobile, desktop) * 2} sizes={`(min-width: 1024px) ${desktop * creatorCropScale(slug)}px, ${mobile * creatorCropScale(slug)}px`} unoptimized={bypassImageOptimization(source!)} onError={() => setFailedSrc(source!)} />
      : <svg viewBox="0 0 24 24" role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={!alt || undefined}><circle cx="12" cy="8" r="4" /><path d="M4 23v-3a8 8 0 0 1 16 0v3" /></svg>}
  </span>;
}
