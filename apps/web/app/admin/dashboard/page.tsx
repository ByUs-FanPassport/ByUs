import { AdminAnalytics, type AnalyticsView } from "../../../components/admin/operations-dashboard";

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ view?: string; lang?: string }> }) {
  const { view, lang } = await searchParams;
  return <AdminAnalytics initialView={(view === "brand" ? "brand" : "creator") as AnalyticsView} locale={lang === "en" ? "en" : "ko"} />;
}
