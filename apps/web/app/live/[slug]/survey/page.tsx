import { type AppLocale } from "@/i18n/locales";
import { parseAppLocale } from "@/i18n/locales";
import { LiveSurveyScreen } from "@/features/live/ui/live-survey-screen";

type Locale = AppLocale;

function resolveLocale(value: string | string[] | undefined): Locale {
  return parseAppLocale(value);
}

export default async function LiveSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <LiveSurveyScreen slug={slug} locale={resolveLocale(query.locale)} />;
}
