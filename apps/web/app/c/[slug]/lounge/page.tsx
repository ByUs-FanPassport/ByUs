import { notFound } from "next/navigation";
import { loadSeoCreator } from "@/server/seo/public-content";
import { LoungeScreen } from "@/features/lounge/ui/lounge-screen";
export const dynamic = "force-dynamic";
export const metadata = { title: "팬 라운지 | ByUs", robots: { index: false, follow: true } };
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = query.locale === "en" ? "en" : "ko";
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  return <LoungeScreen celebrity={celebrity} locale={locale} />;
}
