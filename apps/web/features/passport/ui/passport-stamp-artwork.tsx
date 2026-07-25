"use client";

import {
  BadgeCheck,
  CalendarCheck,
  ClipboardCheck,
  Radio,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";

import {
  STAMP_METADATA,
  stampShortLabel,
  stampTypeLabel,
  type PassportLocale,
  type PassportStampType,
} from "../domain/passport-read-model";
import styles from "./passport-stamp-artwork.module.css";

export type { PassportStampType } from "../domain/passport-read-model";

export interface PassportStampRecord {
  id?: string;
  type: PassportStampType;
  issuedAt: string;
}

const stampIcons: Record<PassportStampType, LucideIcon> = {
  knowledge: BadgeCheck,
  reservation: CalendarCheck,
  attendance: Radio,
  survey: ClipboardCheck,
};

export function StampArtwork({
  type,
  locale,
  label,
  compact = false,
  decorative = false,
}: {
  type: PassportStampType;
  locale: PassportLocale;
  label?: string;
  compact?: boolean;
  decorative?: boolean;
}) {
  const Icon = stampIcons[type];
  const accessibleLabel = label ?? stampTypeLabel(locale, type);
  const stampStyle = {
    "--stamp-ink": STAMP_METADATA[type].inkToken,
  } as CSSProperties;

  return (
    <span
      className={styles.stamp}
      style={stampStyle}
      data-compact={compact}
      data-stamp-type={type}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${accessibleLabel} Stamp`}
    >
      <span className={styles.inner}>
        <Icon aria-hidden="true" />
        <span>{stampShortLabel(locale, type)}</span>
      </span>
    </span>
  );
}

function sortRecentStamps(stamps: readonly PassportStampRecord[]) {
  return [...stamps]
    .sort((left, right) => {
      const timeDifference = Date.parse(left.issuedAt) - Date.parse(right.issuedAt);
      if (timeDifference !== 0) return timeDifference;
      return (left.id ?? "").localeCompare(right.id ?? "");
    })
    .slice(-9);
}

export function PassportStampCanvas({
  celebrityName,
  level,
  stamps,
  totalCount = stamps.length,
  locale,
  priority = false,
  revealCount,
  className,
}: {
  celebrityName: string;
  level?: string;
  stamps: readonly PassportStampRecord[];
  totalCount?: number;
  locale: PassportLocale;
  priority?: boolean;
  revealCount?: number;
  className?: string;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const recentStamps = useMemo(() => sortRecentStamps(stamps), [stamps]);
  const visibleStamps = typeof revealCount === "number"
    ? recentStamps.slice(0, Math.max(0, Math.min(revealCount, recentStamps.length)))
    : recentStamps;
  const countLabel = locale === "ko" ? `Stamp ${totalCount}개` : `${totalCount} ${totalCount === 1 ? "Stamp" : "Stamps"}`;
  const recentLabel = totalCount > 9
    ? locale === "ko"
      ? `전체 ${totalCount}개 중 최근 9개 표시`
      : `Showing the latest 9 of ${totalCount}`
    : countLabel;
  const description = [`${celebrityName} Fan Passport`, level, recentLabel].filter(Boolean).join(", ");

  return (
    <div
      className={[styles.canvas, className].filter(Boolean).join(" ")}
      role={assetFailed ? "group" : "img"}
      aria-label={description}
      data-visible-stamps={visibleStamps.length}
      data-total-stamps={totalCount}
    >
      {assetFailed ? (
        <div className={styles.assetError} role="status">
          {locale === "ko"
            ? "Passport 이미지를 불러오지 못했어요."
            : "The Passport image could not be loaded."}
        </div>
      ) : (
        <Image
          src="/images/guest-home/passport-open-blank-9-transparent.png"
          alt=""
          width={1536}
          height={1024}
          priority={priority}
          aria-hidden="true"
          onError={() => setAssetFailed(true)}
        />
      )}
      <span className={styles.grid} aria-hidden="true">
        {visibleStamps.map((stamp, index) => (
          <span
            className={styles.slot}
            data-passport-stamp={stamp.type}
            key={stamp.id ?? `${stamp.type}-${stamp.issuedAt}-${index}`}
          >
            <StampArtwork type={stamp.type} locale={locale} compact decorative />
          </span>
        ))}
      </span>
    </div>
  );
}
