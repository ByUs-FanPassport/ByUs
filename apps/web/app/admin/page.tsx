import { AdminOverviewDashboard } from "../../features/analytics/ui/admin-overview-dashboard";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  return <AdminOverviewDashboard locale={lang === "en" ? "en" : "ko"} />;
}
