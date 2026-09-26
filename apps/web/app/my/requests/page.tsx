import { z } from "zod";
import { parseAppLocale } from "@/i18n/locales";
import { ParticipationRequests } from "@/features/schedules/ui/participation-requests";
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<{ locale?: string; tab?: string; item?: string }> }) {
  const query = await searchParams;
  return <ParticipationRequests locale={parseAppLocale(query.locale)} initialTab={query.tab === "fanpages" ? "fanpages" : "schedules"} highlightId={z.uuid().optional().catch(undefined).parse(query.item)}/>;
}
