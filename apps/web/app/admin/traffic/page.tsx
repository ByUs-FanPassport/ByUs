import { WebAnalyticsDashboard } from "../../../features/analytics/ui/web-analytics-dashboard";

export default async function AdminTrafficPage({ searchParams }: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  return <WebAnalyticsDashboard locale={lang === "en" ? "en" : "ko"} />;
}
