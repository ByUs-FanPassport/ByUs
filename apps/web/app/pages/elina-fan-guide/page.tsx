import { parseAppLocale } from "@/i18n/locales";
import { elinaRafflesHref } from "@/features/live/domain/elina-event";
import { permanentRedirect } from "next/navigation";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

export default async function Page({ searchParams }: Props) {
  permanentRedirect(elinaRafflesHref(parseAppLocale((await searchParams).locale)));
}
