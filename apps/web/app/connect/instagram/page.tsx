import type { Metadata } from "next";
import { Suspense } from "react";
import { CreatorInstagramPage } from "../../../features/creator-instagram/ui/connection-page";
import { FanRouteLoading } from "../../../components/fan-ui/fan-route-loading";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Instagram 연결 | ByUs", robots: { index: false, follow: false }, referrer: "same-origin" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const locale = query.locale === "en" ? "en" : "ko";
  return <Suspense fallback={<FanRouteLoading locale={locale} />}><CreatorInstagramPage locale={locale} /></Suspense>;
}
