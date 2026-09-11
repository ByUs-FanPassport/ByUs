import { publicMetadata } from "@/seo/metadata";
import { BusinessInquiryPage } from "@/components/business-inquiries/business-inquiry-page";
import { businessPageContent, businessPagePaths } from "@/components/business-inquiries/content";

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  const t = businessPageContent.partner[locale];
  return publicMetadata({ path: businessPagePaths.partner, locale, title: `${t.title} | ByUs`, description: t.description.replace(/\n/g, " ") });
}

export default async function Page({ searchParams }: Props) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return <BusinessInquiryPage kind="partner" locale={locale} />;
}
