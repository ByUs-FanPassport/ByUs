import type { Metadata } from "next";

import { ServiceGuidePage } from "@/components/service-guide/service-guide-page";
import { serviceGuideContent } from "@/components/service-guide/content";
import { publicMetadata } from "@/seo/metadata";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

function resolveLocale(locale?: string | string[]) {
  return locale === "en" ? "en" : "ko";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = resolveLocale((await searchParams).locale);
  const content = serviceGuideContent[locale];
  return publicMetadata({
    path: "/guide",
    locale,
    title: `${content.metadataTitle} | ByUs`,
    description: content.metadataDescription,
  });
}

export default async function GuidePage({ searchParams }: Props) {
  const locale = resolveLocale((await searchParams).locale);
  return <ServiceGuidePage locale={locale} />;
}
