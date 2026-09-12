import { redirect } from "next/navigation";
import { ifewLiveHref } from "@/features/live/domain/ifew-event";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

/** The event has ended; retain shared links through its historical LIVE detail. */
export default async function Page({ searchParams }: Props) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  redirect(ifewLiveHref(locale));
}
