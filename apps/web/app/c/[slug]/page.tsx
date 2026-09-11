import { publicMetadata } from "@/seo/metadata";
import { loadSeoCreator } from "@/server/seo/public-content";
import { resolvePhoto } from "@/features/media/domain/public-image";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import { sanitizeAuthIntentId } from "@/components/login-intent";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { CelebrityFanPage, type CelebrityFanTab } from "../../../components/celebrity-fan-page";
import { createPublishedContentRepositoryFromEnvironment } from "../../../server/content/published-content-repository";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  const otherLocale = locale === "en" ? "ko" : "en";
  const translated = await loadSeoCreator(slug, otherLocale);
  const photo = resolvePhoto(celebrity.image.photos, "creator.hero.desktop", celebrity.image.url, locale);
  return publicMetadata({ path: `/c/${slug}`, locale, title: `${celebrity.name} | ByUs`, description: celebrity.summary,
    image: photo.src, imageAlt: photo.alt ?? celebrity.image.alt,
    locales: translated ? ["ko", "en"] : [locale] });
}

export default async function CelebrityPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string; tab?: string; authIntent?: string }> }) {
  const { slug } = await params;
  const { locale: requestedLocale, tab: requestedTab, authIntent: requestedAuthIntent } = await searchParams;
  const locale = requestedLocale === "en" ? "en" : "ko";
  if (requestedTab === "raffles" || requestedTab === "benefits") {
    const authIntent = sanitizeAuthIntentId(requestedAuthIntent);
    redirect(`${creatorRafflesHref(slug, locale)}${authIntent ? `&authIntent=${authIntent}` : ""}` as Route);
  }
  const initialTab: CelebrityFanTab = requestedTab === "notice" || requestedTab === "live" || requestedTab === "benefits" || requestedTab === "certifications" || requestedTab === "raffles" || requestedTab === "leaderboard" ? requestedTab : "home";
  const repository = createPublishedContentRepositoryFromEnvironment();
  const [celebrity, primaryLives] = await Promise.all([
    loadSeoCreator(slug, locale),
    repository.listPrimaryLives(locale),
  ]);
  if (!celebrity) notFound();
  const upcomingLive = primaryLives.find((live) => live.celebritySlug === slug) ?? null;
  return <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={upcomingLive} initialTab={initialTab} instagramEnabled={process.env.INSTAGRAM_INTEGRATION_ENABLED === "true"} />;
}
