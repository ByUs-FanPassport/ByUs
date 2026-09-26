import { ArrowLeft } from "lucide-react";
import { FanAction } from "@/components/fan-ui/fan-action";
import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { ScheduleSuggestionForm } from "@/features/schedules/ui/schedule-suggestion-form";
import { ParticipationPage } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { parseAppLocale } from "@/i18n/locales";
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = parseAppLocale(query.locale), c = participationCopy(locale);
  return <ParticipationPage locale={locale} title={c.suggest} path={`/c/${slug}/schedule-suggestions`} backAction={<FanAction variant="text" href={creatorHomeHref(slug, locale)} leadingIcon={<ArrowLeft />}>{c.back}</FanAction>}><ScheduleSuggestionForm celebritySlug={slug} locale={locale} /></ParticipationPage>;
}
