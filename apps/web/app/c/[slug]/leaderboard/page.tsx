import { creatorHomeHref } from "@/features/creator/domain/creator-navigation";
import { redirect } from "next/navigation";
import type { Route } from "next";
export const dynamic = "force-dynamic";
/** The canonical panel uses the server's membership gate, including direct links. */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const { slug } = await params;
  const { locale } = await searchParams;
  redirect(`${creatorHomeHref(encodeURIComponent(slug))}?tab=leaderboard&locale=${locale === "en" ? "en" : "ko"}#celebrity-content` as Route);
}
