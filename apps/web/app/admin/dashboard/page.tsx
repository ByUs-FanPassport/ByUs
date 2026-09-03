import { PlatformDashboard } from "../../../features/analytics/ui/platform-dashboard";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  return <PlatformDashboard locale={lang === "en" ? "en" : "ko"} />;
}
