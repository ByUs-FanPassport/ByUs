import { parseAppLocale } from "@/i18n/locales";
import { publicMetadata } from "@/seo/metadata";
import type { Metadata } from "next";
import { fanmeetingContent } from "@/components/us-fanmeetings/content";
import { UsFanmeetingsPage } from "@/components/us-fanmeetings/us-fanmeetings-page";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const locale = parseAppLocale((await searchParams).locale);
  const content = fanmeetingContent[locale];
  const title = `${content.hero.replace(/\n/g, " ")} | ByUs`;
  const description = content.desc.replace(/\n/g, " ");
  return publicMetadata({ path: "/pages/us-fanmeetings", locale, title, description });
}

export default async function Page({ searchParams }: Props) {
  const locale = parseAppLocale((await searchParams).locale);
  return <UsFanmeetingsPage locale={locale} />;
}
