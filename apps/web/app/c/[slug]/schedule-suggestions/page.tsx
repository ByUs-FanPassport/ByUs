import { ScheduleSuggestionForm } from "@/features/schedules/ui/schedule-suggestion-form";
import { ParticipationPage } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { parseAppLocale } from "@/i18n/locales";
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) { const locale = parseAppLocale((await searchParams).locale); return <ParticipationPage locale={locale} title={participationCopy(locale).suggest} path="/live"><ScheduleSuggestionForm celebritySlug={(await params).slug} locale={locale} /></ParticipationPage>; }
