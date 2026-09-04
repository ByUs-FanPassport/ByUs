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
  points?: number;
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
  celebrityName,
  issuedAt,
  points,
  compact = false,
  decorative = false,
}: {
  type: PassportStampType;
  locale: PassportLocale;
  label?: string;
  celebrityName?: string;
  issuedAt?: string;
  points?: number;
  compact?: boolean;
  decorative?: boolean;
}) {
  const Icon = stampIcons[type];
  const accessibleLabel = label ?? stampTypeLabel(locale, type);
  const accessibleDate = issuedAt
    ? new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(issuedAt))
    : null;
  const stampDescription = [
    celebrityName,
    `${accessibleLabel} Stamp`,
    accessibleDate,
    typeof points === "number"
      ? locale === "ko"
        ? `${points}점 획득`
        : `${points} ${points === 1 ? "point" : "points"} earned`
      : null,
  ].filter(Boolean).join(", ");
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
      aria-label={decorative ? undefined : stampDescription}
    >
      <span className={styles.frame} aria-hidden="true" />
      <span className={styles.accentDots} aria-hidden="true"><i /><i /></span>
      <span className={styles.inner}>
        <Icon aria-hidden="true" />
        <span>{stampShortLabel(locale, type)}</span>
      </span>
    </span>
  );
}

function visualDate(value: string): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

export function VerificationSealArtwork({
  celebrityName,
  issuedAt,
  points,
  locale,
}: {
  celebrityName: string;
  issuedAt: string;
  points: number;
  locale: PassportLocale;
}) {
  const typeLabel = stampTypeLabel(locale, "knowledge");
  const accessibleDate = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(issuedAt));
  const accessibleLabel = locale === "ko"
    ? `${celebrityName} ${typeLabel} Stamp, ${accessibleDate}, ${points}점 획득`
    : `${celebrityName} ${typeLabel} Stamp, ${accessibleDate}, ${points} ${points === 1 ? "point" : "points"} earned`;

  return (
    <span
      className={styles.verificationSeal}
      role="img"
      aria-label={accessibleLabel}
      data-verification-seal
    >
      <span className={styles.verificationFrame} aria-hidden="true" />
      <span className={styles.verificationDots} aria-hidden="true"><i /><i /></span>
      <span className={styles.verificationCopy} aria-hidden="true">
        <span className={styles.verificationTitle}>{locale === "ko" ? "팬 인증" : "FAN"}</span>
        <strong>VERIFIED</strong>
        <span className={styles.verificationDate}>{visualDate(issuedAt)}</span>
        <b>+{points}</b>
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
  loading = false,
}: {
  celebrityName: string;
  level?: string;
  stamps: readonly PassportStampRecord[];
  totalCount?: number;
  locale: PassportLocale;
  priority?: boolean;
  revealCount?: number;
  className?: string;
  loading?: boolean;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const [assetLoaded, setAssetLoaded] = useState(false);
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
  const visibleStampDescriptions = visibleStamps.map((stamp) => {
    const stampName = stampTypeLabel(locale, stamp.type);
    const stampDate = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(stamp.issuedAt));
    const pointText = typeof stamp.points === "number"
      ? locale === "ko"
        ? `${stamp.points}점 획득`
        : `${stamp.points} ${stamp.points === 1 ? "point" : "points"} earned`
      : null;
    return [stampName, stampDate, pointText].filter(Boolean).join(", ");
  });
  const description = [
    `${celebrityName} Fan Passport`,
    level,
    recentLabel,
    ...visibleStampDescriptions,
  ].filter(Boolean).join(", ");
  const isLoading = !assetFailed && (loading || !assetLoaded);

  return (
    <div
      className={[styles.canvas, className].filter(Boolean).join(" ")}
      role={assetFailed ? "group" : "img"}
      aria-label={description}
      aria-busy={isLoading}
      data-passport-ready={isLoading ? "false" : "true"}
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
          onLoad={() => setAssetLoaded(true)}
          onError={() => {
            setAssetLoaded(false);
            setAssetFailed(true);
          }}
        />
      )}
      <span className={styles.grid} aria-hidden="true">
        {visibleStamps.map((stamp, index) => (
          <span
            className={styles.slot}
            data-passport-stamp={stamp.type}
            key={stamp.id ?? `${stamp.type}-${stamp.issuedAt}-${index}`}
          >
            <StampArtwork
              type={stamp.type}
              locale={locale}
              celebrityName={celebrityName}
              issuedAt={stamp.issuedAt}
              points={stamp.points}
              compact
              decorative
            />
          </span>
        ))}
      </span>
      {isLoading ? (
        <span className={styles.canvasSkeleton} aria-hidden="true">
          <span className={styles.skeletonCover} />
          <span className={styles.skeletonIdentity}><i /><i /><i /></span>
          <span className={styles.skeletonStampGrid}>
            {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
          </span>
        </span>
      ) : null}
    </div>
  );
}
