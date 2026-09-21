import { BanksyCampaignDashboard } from "../../../features/analytics/ui/banksy-campaign-dashboard";

export default async function AdminCampaignsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  return <BanksyCampaignDashboard locale={lang === "en" ? "en" : "ko"} />;
}
