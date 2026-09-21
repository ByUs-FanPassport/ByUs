import { parseAppLocale } from "@/i18n/locales";
import { redirect } from "next/navigation";
import { ifewLiveHref } from "@/features/live/domain/ifew-event";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

/** The event has ended; retain shared links through its historical LIVE detail. */
export default async function Page({ searchParams }: Props) {
  const locale = parseAppLocale((await searchParams).locale);
  redirect(ifewLiveHref(locale));
}
