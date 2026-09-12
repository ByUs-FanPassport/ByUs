import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NO_INDEX } from "@/seo/metadata";
import { loadSeoCreator } from "@/server/seo/public-content";
import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import { resolveSharedPassport } from "@/server/community-stamps/shared-passport";
import { SharedPassportLanding } from "@/features/community-stamps/ui/shared-passport-landing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared Passport | ByUs", robots: NO_INDEX, referrer: "no-referrer",
  openGraph: { title: "A favorite worth sharing | ByUs", images: ["/share/default.png"] },
};

export default async function SharedPassportPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ locale?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const link = await resolveSharedPassport(token, createFanpageDependencies());
  if (!link) notFound();
  const creator = await loadSeoCreator(link.creator, locale);
  if (!creator) notFound();
  return <SharedPassportLanding token={token} locale={locale}
    creator={{ slug: creator.slug, name: creator.name, image: { url: creator.image.url, alt: creator.image.alt } }} />;
}
