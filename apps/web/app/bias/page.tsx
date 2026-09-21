import { parseAppLocale } from "@/i18n/locales";
import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; celebrity?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({
    locale: parseAppLocale(params.locale),
  });
  if (typeof params.celebrity === "string")
    query.set("celebrity", params.celebrity);
  redirect(`/bias/promotion?${query}`);
}
