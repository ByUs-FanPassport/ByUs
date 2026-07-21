import { LiveEventScreen } from "@/features/live/ui/live-event-screen";

type Locale = "ko" | "en";

function resolveLocale(value: string | string[] | undefined): Locale {
  return value === "en" ? "en" : "ko";
}

export default async function LiveEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <LiveEventScreen slug={slug} locale={resolveLocale(query.locale)} />;
}
