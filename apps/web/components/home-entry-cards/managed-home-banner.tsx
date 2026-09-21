"use client";

import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__home-entry-cards__managed-home-banner";
import { translate } from "@/i18n/messages";
import { getImageProps } from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { localizedBannerHref, type HomeBanner } from "../../features/home/domain/home-banner";
import { HomeHeroBanner } from "./home-hero-banner";
import { bypassImageOptimization } from "../fan-ui/public-image-policy";
import styles from "./managed-home-banner.module.css";

function BannerArtwork({ banner, priority }: { banner: HomeBanner; priority: boolean }) {
  const [failed, setFailed] = useState(false);
  const mobile = banner.mobileImage ?? banner.desktopImage;
  const propsFor = (asset: typeof mobile) => getImageProps({
    src: asset.url, alt: banner.alt, unoptimized: bypassImageOptimization(asset.url), width: asset.width, height: asset.height,
    sizes: "(max-width: 767px) calc(100vw - 32px), (max-width: 1199px) calc(100vw - 64px), 1100px",
  }).props;
  const desktopProps = propsFor(banner.desktopImage);
  const mobileProps = propsFor(mobile);
  return failed ? <div className={styles.unavailable} data-banner-image-unavailable /> : (
    <picture className={styles.artwork} data-mobile-fallback={!banner.mobileImage}>
      <source media="(min-width: 768px)" srcSet={desktopProps.srcSet ?? desktopProps.src} sizes={desktopProps.sizes} />
      {/* getImageProps supplies Next's optimized image sources for the responsive picture. */}
      <img {...mobileProps} alt={banner.alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} onError={() => setFailed(true)} />
    </picture>
  );
}

export function ManagedHomeBanner({ banner, locale, priority = false }: { banner: HomeBanner; locale: AppLocale; priority?: boolean }) {
  const artwork = <BannerArtwork key={`${banner.desktopImage.id}:${banner.mobileImage?.id ?? ""}`} banner={banner} priority={priority} />;
  return <div className={styles.root} data-managed-home-banner={banner.id}>
    <HomeHeroBanner kind="live" image={null} fullImage={artwork}
      eyebrow={banner.kind === "regular_live" ? (locale === "ko" ? "정기 방송" : translate(locale, localizedMessages.me0d4dde550fa, "Regular LIVE")) : (locale === "ko" ? "ByUs 소식" : translate(locale, localizedMessages.m11331552a52b, "ByUs news"))}
      title={banner.title} description={banner.description}
      action={<Link href={localizedBannerHref(banner.href, locale) as Route}><span>{banner.ctaLabel}</span><ArrowRight aria-hidden="true" /></Link>} />
  </div>;
}
