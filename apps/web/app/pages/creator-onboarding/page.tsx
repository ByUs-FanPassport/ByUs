import { parseAppLocale } from "@/i18n/locales";
import { publicMetadata } from "@/seo/metadata";
import { BusinessInquiryPage } from "@/components/business-inquiries/business-inquiry-page";
import { businessPageContent, businessPagePaths } from "@/components/business-inquiries/content";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props) {
  const locale = parseAppLocale((await searchParams).locale);
  const t = businessPageContent.creator[locale];
  return publicMetadata({ path: businessPagePaths.creator, locale, title: `${t.title} | ByUs`, description: t.description.replace(/\n/g, " ") });
}

export default async function Page({ searchParams }: Props) {
  const locale = parseAppLocale((await searchParams).locale);
  return <BusinessInquiryPage kind="creator" locale={locale} />;
}
