import { LiveCalendarScreen } from "@/features/live/ui/live-calendar-screen";
import { resolveLiveCalendarMonth } from "@/features/live/domain/live-calendar";
import { loadServerEnv } from "@/server/config/env";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { createLiveCalendarRepositoryFromEnvironment } from "@/server/g3/live-calendar-repository";
import { createLiveEventRepositoryFromEnvironment } from "@/server/g3/live-event-repository";

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
  const repositoryConfig = {
    url: environment.SUPABASE_URL,
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  };
  const repository = createLiveCalendarRepositoryFromEnvironment(repositoryConfig);
  const contentRepository = createPublishedContentRepositoryFromEnvironment();
  const liveRepository = createLiveEventRepositoryFromEnvironment(repositoryConfig);
  const now = new Date();
  const [calendar, publishedCelebrities] = await Promise.all([
    repository.readMonth({ month, locale, appUserId: null, now }),
    contentRepository.list(locale),
  ]);
  const celebrities = publishedCelebrities.map((celebrity) => ({
    slug: celebrity.slug,
    name: celebrity.name,
    image: celebrity.image.url,
  }));
  const availableSlugs = new Set(celebrities.map((celebrity) => celebrity.slug));
  const requestedCelebritySlugs = (Array.isArray(requested.celebrity)
    ? requested.celebrity
    : requested.celebrity ? [requested.celebrity] : [])
    .filter((slug, index, values) => availableSlugs.has(slug) && values.indexOf(slug) === index);
  const eventSlugs = [...new Set(calendar.days.flatMap((day) => day.events.map((event) => event.slug)))];
  const liveResponses = await Promise.all(eventSlugs.map((slug) =>
    liveRepository.findPublishedBySlug({ slug, locale, appUserId: null, now }),
  ));
  const eventMetadata = liveResponses
    .filter((response) => response !== null)
    .map(({ live }) => ({
      eventSlug: live.slug,
      celebritySlug: live.celebrity.slug,
      platforms: [live.watch.provider],
    }));

  return <LiveCalendarScreen
    initialCalendar={calendar}
    locale={locale}
    celebrities={celebrities}
    eventMetadata={eventMetadata}
    initialCelebritySlugs={requestedCelebritySlugs}
  />;
}
