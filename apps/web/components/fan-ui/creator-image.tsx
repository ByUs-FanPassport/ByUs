"use client";

import type { PhotoSet } from "@/features/media/domain/public-image";
import Image, { type ImageProps } from "next/image";
import { useState, type CSSProperties, type ReactNode } from "react";
import { creatorImageSizes, creatorPresentationRole, resolveCreatorImage, type CreatorImagePresentation } from "./creator-image-config";
import { bypassImageOptimization } from "./public-image-policy";
import styles from "./creator-image.module.css";

type Props = Pick<ImageProps, "alt" | "width" | "height" | "fill" | "priority" | "className"> & {
  slug: string;
  src: string | null | undefined;
  presentation?: CreatorImagePresentation;
  position?: string;
  photos: PhotoSet | undefined;
  locale?: "ko" | "en";
  sizes: string;
  fallback?: ReactNode;
  framed?: boolean;
};

/** All creator identity photos share source selection, framing, sizing and load recovery. */
export function CreatorImage({ slug, src, presentation = "portrait", position, photos, locale = "ko", sizes, fallback = null, framed = false, ...imageProps }: Props) {
  const image = resolveCreatorImage({ slug, src, presentation, position, photos });
  const role = creatorPresentationRole(presentation);
  const alt = imageProps.alt === "" ? "" : photos?.[role]?.alt[locale] ?? imageProps.alt;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const photo = !image.src || image.src === failedSource ? fallback : <Image {...imageProps} alt={alt} className={framed ? undefined : imageProps.className} src={image.src} sizes={creatorImageSizes(sizes, image.crop.scale)}
    data-creator-image={slug} data-image-presentation={presentation}
    style={{ objectFit: image.crop.fit ?? "cover", objectPosition: image.crop.position,
      transform: image.crop.scale !== 1 || image.crop.translateX ? `${image.crop.translateX ? `translateX(${image.crop.translateX}) ` : ""}scale(${image.crop.scale})` : undefined,
      transformOrigin: image.crop.origin }}
    unoptimized={bypassImageOptimization(image.src)} onError={() => setFailedSource(image.src!)} />;
  return framed ? <span className={`${styles.frame} ${imageProps.className ?? ""}`}
    data-creator-image-frame={slug}
    style={{ "--creator-frame-width": `${imageProps.width}px`, "--creator-frame-height": `${imageProps.height}px` } as CSSProperties}>{photo}</span> : photo;
}
