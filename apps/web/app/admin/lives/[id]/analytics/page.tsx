import { LiveDashboard } from "../../../../../features/analytics/ui/live-dashboard";
export default async function AdminLiveAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ id }, { lang }] = await Promise.all([params, searchParams]);
  return (
    <LiveDashboard liveEventId={id} locale={lang === "en" ? "en" : "ko"} />
  );
}
