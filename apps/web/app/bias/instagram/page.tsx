import { redirect } from "next/navigation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const { locale } = await searchParams;
  redirect(`/connect/instagram?locale=${locale === "en" ? "en" : "ko"}`);
}
