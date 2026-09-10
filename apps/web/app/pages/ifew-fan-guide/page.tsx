import type { Metadata } from "next";
import { FanParticipationGuide } from "@/components/fan-participation-guide/fan-participation-guide";
import { ifewEventBanner, ifewFanGuideContent } from "@/components/ifew-fan-guide/content";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };
const resolveLocale = (locale?: string | string[]) => locale === "en" ? "en" : "ko";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = resolveLocale((await searchParams).locale);
  const content = ifewFanGuideContent[locale];
  const title = `${content.heroTitle.replace(/\n/g, " ")} | ByUs`;
  const description = `${content.heroDescription.replace(/\n/g, " ")} ${content.heroSchedule}`;
  const url = `https://byus.kr/pages/ifew-fan-guide?locale=${locale}`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: { ko: "https://byus.kr/pages/ifew-fan-guide?locale=ko", en: "https://byus.kr/pages/ifew-fan-guide?locale=en" },
    },
    openGraph: { title, description, url, type: "website", locale: locale === "en" ? "en_US" : "ko_KR", images: [{ url: ifewEventBanner, alt: content.eventImageAlt }] },
  };
}

export default async function Page({ searchParams }: Props) {
  return <FanParticipationGuide locale={resolveLocale((await searchParams).locale)} creator="ifew" />;
}
