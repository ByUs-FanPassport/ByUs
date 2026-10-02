import { redirect } from "next/navigation";
import { parseAppLocale, toContentLocale } from "@/i18n/locales";

export const metadata = { robots: { index: false, follow: false } };

export default async function ByusDayLink({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const { locale } = await searchParams;
  redirect(`/connect/byus-day?locale=${toContentLocale(parseAppLocale(locale))}`);
}
