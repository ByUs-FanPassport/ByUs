import { notFound } from "next/navigation";
import { loadSeoCreator } from "@/server/seo/public-content";
import { createRaffleDependencies } from "@/server/raffle/raffle-dependencies";
import { CreatorRafflesScreen } from "@/features/benefit/ui/creator-raffles-screen";
import { createBenefitRepositoryFromEnvironment } from "@/server/g4/benefit-repository";
import { loadServerEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";

export default async function CreatorRaffleDetailPage({ params, searchParams }: {
  params: Promise<{ slug: string; benefitId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ slug, benefitId }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  const { raffles } = await createRaffleDependencies().list({ celebritySlug: slug, locale, now: new Date() });
  if (!raffles.some((raffle) => raffle.benefitId === benefitId)) notFound();
  const environment = loadServerEnv();
  const publicBenefit = await createBenefitRepositoryFromEnvironment({ url: environment.SUPABASE_URL, serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY }).find({ benefitId, locale, appUserId: null, now: new Date() });
  if (!publicBenefit) notFound();
  return <CreatorRafflesScreen celebrity={celebrity} locale={locale} raffles={raffles} benefitId={benefitId} deliveryInstructions={publicBenefit.deliveryLabel} />;
}
