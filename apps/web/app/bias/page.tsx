import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string; celebrity?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({
    locale: params.locale === "en" ? "en" : "ko",
  });
  if (typeof params.celebrity === "string")
    query.set("celebrity", params.celebrity);
  redirect(`/bias/promotion?${query}`);
}
