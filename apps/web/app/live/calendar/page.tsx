import { LiveCalendarScreen } from "@/features/live/ui/live-calendar-screen";
import { resolveLiveCalendarMonth } from "@/features/live/domain/live-calendar";
import { loadServerEnv } from "@/server/config/env";
import { createLiveCalendarRepositoryFromEnvironment } from "@/server/g3/live-calendar-repository";

export const dynamic = "force-dynamic";

function currentKstMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Seoul",
  }).formatToParts(now);
  const year = parts.find(({ type }) => type === "year")?.value;
  const month = parts.find(({ type }) => type === "month")?.value;
  return `${year}-${month}`;
}

export default async function LiveCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = await searchParams;
  const locale = requested.locale === "en" ? "en" : "ko";
  const month = resolveLiveCalendarMonth(requested.month, currentKstMonth());
  const environment = loadServerEnv();
  const repository = createLiveCalendarRepositoryFromEnvironment({
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
  const calendar = await repository.readMonth({ month, locale, appUserId: null, now: new Date() });

  return <LiveCalendarScreen initialCalendar={calendar} locale={locale} />;
}
