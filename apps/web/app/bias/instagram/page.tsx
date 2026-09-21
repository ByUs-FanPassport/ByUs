import { parseAppLocale } from "@/i18n/locales";
import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { locale } = await searchParams;
  redirect(`/connect/instagram?locale=${parseAppLocale(locale)}`);
}
