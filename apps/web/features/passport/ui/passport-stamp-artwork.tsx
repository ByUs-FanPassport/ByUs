"use client";

import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__passport__ui__passport-stamp-artwork";
import { translate } from "@/i18n/messages";
import {
  BadgeCheck,
  CalendarCheck,
  ClipboardCheck,
  Crown,
  Radio,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState, type CSSProperties } from "react";

import {
  STAMP_METADATA,
  stampShortLabel,
  stampTypeLabel,
  levelLabel,
  levelSchema,
  type PassportStampType,
} from "../domain/passport-read-model";
import styles from "./passport-stamp-artwork.module.css";
import { displayStampLabel, type PassportDisplayStamp, type PassportDisplayStampType } from "../domain/first-like-stamp";

export type { PassportStampType } from "../domain/passport-read-model";

export type PassportStampRecord = PassportDisplayStamp;

function pointUnit(locale: AppLocale, points: number): string {
  const singular = new Intl.PluralRules(locale).select(points) === "one";
  return {
    ko: "점", en: singular ? "point" : "points", ja: "点",
    "zh-Hans": "分", "zh-Hant": "分", es: singular ? "punto" : "puntos",
    id: "poin", vi: "điểm", th: "คะแนน",
    pt: singular ? "ponto" : "pontos", fr: singular ? "point" : "points",
  }[locale];
}

const stampIcons: Record<PassportStampType, LucideIcon> = {
  knowledge: BadgeCheck,
  reservation: CalendarCheck,
  attendance: Radio,
  survey: ClipboardCheck,
  membership: Crown,
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
  type: PassportDisplayStampType;
  locale: AppLocale;
  label?: string;
  celebrityName?: string;
  issuedAt?: string;
  points?: number;
  compact?: boolean;
  decorative?: boolean;
}) {
  const accessibleLabel = label ?? displayStampLabel(locale, type);
  const accessibleDate = issuedAt
    ? new Intl.DateTimeFormat(locale, { calendar: "gregory",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(issuedAt))
    : null;
  const stampDescription = [
    celebrityName,
    `${accessibleLabel} Stamp`,
    accessibleDate,
    type !== "first_reaction" && typeof points === "number"
      ? locale === "ko" ? `${points}점 획득` : translate(locale, localizedMessages.m2ffacf60eac4, "{0} {1} earned", [points, pointUnit(locale, points)])
      : null,
  ].filter(Boolean).join(", ");
  if (type === "first_reaction") {
    return <span className={styles.stamp} data-compact={compact} data-stamp-type={type}
      aria-hidden={decorative || undefined} role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : stampDescription}>
      <Image className={styles.stampAsset} src={`/images/stamps/first-like-${toContentLocale(locale)}.webp`} width={512} height={512} alt="" aria-hidden="true" />
    </span>;
  }
  const Icon = stampIcons[type];
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
  locale: AppLocale;
}) {
  const typeLabel = stampTypeLabel(locale, "knowledge");
  const accessibleDate = new Intl.DateTimeFormat(locale, { calendar: "gregory",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(issuedAt));
  const accessibleLabel = locale === "ko" ? `${celebrityName} ${typeLabel} Stamp, ${accessibleDate}, ${points}점 획득` : translate(locale, localizedMessages.ma6f6c98a5da9, "{0} {1} Stamp, {2}, {3} {4} earned", [celebrityName, typeLabel, accessibleDate, points, pointUnit(locale, points)]);

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
        <span className={styles.verificationTitle}>{locale === "ko" ? "팬 인증" : translate(locale, localizedMessages.mca74f42669ae, "FAN")}</span>
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
  locale: AppLocale;
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
  const countLabel = locale === "ko" ? `Stamp ${totalCount}개` : locale === "en" ? `${totalCount} ${totalCount === 1 ? "Stamp" : "Stamps"}` : `${totalCount.toLocaleString(locale)} Stamp`;
  const recentLabel = totalCount > 9
    ? locale === "ko" ? `전체 ${totalCount}개 중 최근 9개 표시` : translate(locale, localizedMessages.m045a5cc4ee53, "Showing the latest 9 of {0}", [totalCount])
    : countLabel;
  const visibleStampDescriptions = visibleStamps.map((stamp) => {
    const stampName = displayStampLabel(locale, stamp.type);
    const stampDate = new Intl.DateTimeFormat(locale, { calendar: "gregory",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(stamp.issuedAt));
    const pointText = stamp.type !== "first_reaction" && typeof stamp.points === "number"
      ? locale === "ko" ? `${stamp.points}점 획득` : translate(locale, localizedMessages.mbf71b36969f2, "{0} {1} earned", [stamp.points, pointUnit(locale, stamp.points)])
      : null;
    return [stampName, stampDate, pointText].filter(Boolean).join(", ");
  });
  const parsedLevel = levelSchema.safeParse(level);
  const description = [
    `${celebrityName} Fan Passport`,
    parsedLevel.success ? levelLabel(locale, parsedLevel.data) : level,
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
          {locale === "ko" ? "Passport 이미지를 불러오지 못했어요." : translate(locale, localizedMessages.ma2e490dda1bc, "The Passport image could not be loaded.")}
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
