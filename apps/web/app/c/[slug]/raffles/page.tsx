import { notFound } from "next/navigation";
import { loadSeoCreator } from "@/server/seo/public-content";
import { createRaffleDependencies } from "@/server/raffle/raffle-dependencies";
import { CreatorRafflesScreen } from "@/features/benefit/ui/creator-raffles-screen";

export const dynamic = "force-dynamic";

export default async function CreatorRafflesPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  const { raffles } = await createRaffleDependencies().list({ celebritySlug: slug, locale, now: new Date() });
  return <CreatorRafflesScreen celebrity={celebrity} locale={locale} raffles={raffles} />;
}
