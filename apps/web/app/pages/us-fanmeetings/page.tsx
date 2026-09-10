import type { Metadata } from "next";
import { fanmeetingContent } from "@/components/us-fanmeetings/content";
import { UsFanmeetingsPage } from "@/components/us-fanmeetings/us-fanmeetings-page";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  const content = fanmeetingContent[locale];
  const title = `${content.hero.replace(/\n/g, " ")} | ByUs × KH`;
  const description = content.desc.replace(/\n/g, " ");
  const url = `https://byus.kr/pages/us-fanmeetings?locale=${locale}`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ko: "https://byus.kr/pages/us-fanmeetings?locale=ko",
        en: "https://byus.kr/pages/us-fanmeetings?locale=en",
      },
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      locale: locale === "en" ? "en_US" : "ko_KR",
    },
  };
}

export default async function Page({ searchParams }: Props) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return <UsFanmeetingsPage locale={locale} />;
}
