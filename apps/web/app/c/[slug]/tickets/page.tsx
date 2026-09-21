import { parseAppLocale } from "@/i18n/locales";
import { notFound } from "next/navigation";
import { loadSeoCreator } from "@/server/seo/public-content";
import { FanTicketHistoryScreen } from "@/features/tickets/ui/fan-ticket-history-screen";

export const dynamic = "force-dynamic";

export default async function CreatorTicketHistoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = parseAppLocale(query.locale);
  const creator = await loadSeoCreator(slug, locale);
  if (!creator) notFound();
  return <FanTicketHistoryScreen creatorSlug={creator.slug} creatorName={creator.name} locale={locale} />;
}
