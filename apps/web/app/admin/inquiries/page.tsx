import { AdminInquiryScreen } from "@/features/support/ui/inquiry-screen";
import { NO_INDEX } from "@/seo/metadata";
export const metadata = { robots: NO_INDEX };
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const locale = (await searchParams).lang === "en" ? "en" : "ko";
  return <AdminInquiryScreen locale={locale} />;
}
