import { InquiryScreen } from "@/features/support/ui/inquiry-screen";
import { NO_INDEX } from "@/seo/metadata";
export const metadata = { robots: NO_INDEX };
export default async function Page({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return <InquiryScreen locale={locale} />;
}
