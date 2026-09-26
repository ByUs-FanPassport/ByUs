import { FanpageRequestForm } from "@/features/fanpage-requests/ui/fanpage-request-form";
import { ParticipationPage } from "@/features/schedules/ui/participation-ui";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { parseAppLocale } from "@/i18n/locales";
export default async function Page({ searchParams }: { searchParams: Promise<{ locale?: string; name?: string }> }) { const query = await searchParams, locale = parseAppLocale(query.locale); return <ParticipationPage locale={locale} title={participationCopy(locale).requests} path="/discover"><FanpageRequestForm locale={locale} initialName={query.name?.slice(0, 120)} /></ParticipationPage>; }
