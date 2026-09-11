"use client";

import { type ComponentProps } from "react";
import { CreatorImage } from "@/components/fan-ui/creator-image";
import type { MySummary } from "@/features/my/domain/my-summary";
import { PassportStampCanvas } from "./passport-stamp-artwork";
import styles from "./passport-identity-artwork.module.css";

type Props = Omit<ComponentProps<typeof PassportStampCanvas>, "celebrityName"> & {
  celebrity: MySummary["creators"][number]["celebrity"];
};

/** Compact Home identity layer. Detail and issuance keep the original canvas. */
export function PassportIdentityArtwork({ celebrity, ...canvas }: Props) {
  return <div className={styles.artwork} data-passport-identity={celebrity.slug}>
    <PassportStampCanvas {...canvas} celebrityName={celebrity.name} />
    <span className={styles.portrait} aria-hidden="true">
      <span className={styles.photo} data-creator={celebrity.slug}>
        <CreatorImage slug={celebrity.slug} src={celebrity.image} photos={celebrity.photos} position={celebrity.imagePosition} presentation="passport"
          alt="" width={440} height={354} sizes="96px"
          fallback={<span className={styles.fallback}>{celebrity.name}</span>} />
      </span>
      <svg className={styles.frame} viewBox="0 0 440 354" fill="none" aria-hidden="true">
        <path d="M28 10H412Q412 28 430 28V326Q412 326 412 344H28Q28 326 10 326V28Q28 28 28 10Z" stroke="currentColor" strokeWidth="3" />
        <path d="M34 16H406Q409 31 424 34V320Q409 323 406 338H34Q31 323 16 320V34Q31 31 34 16Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 0Q10 10 0 10Q10 10 10 20Q10 10 20 10Q10 10 10 0ZM430 0Q430 10 420 10Q430 10 430 20Q430 10 440 10Q430 10 430 0ZM10 334Q10 344 0 344Q10 344 10 354Q10 344 20 344Q10 344 10 334ZM430 334Q430 344 420 344Q430 344 430 354Q430 344 440 344Q430 344 430 334Z" fill="currentColor" />
      </svg>
    </span>
  </div>;
}
