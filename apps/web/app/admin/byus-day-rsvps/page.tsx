import { ByusDayRsvpManager } from "@/components/admin/byus-day-rsvp-manager";
import { NO_INDEX } from "@/seo/metadata";

export const metadata = { title: "ByUs Day RSVP | ByUs Admin", robots: NO_INDEX };

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === "en" ? "en" : "ko";
  return <ByusDayRsvpManager locale={locale} />;
}
