import { QuizEntryScreen } from "../../../../features/quiz/ui/quiz-entry-screen";
import { sanitizeLiveReturnTo } from "../../../../features/quiz/domain/live-return-context";
import { sanitizeLocale } from "../../../../components/login-intent";
import { isCreatorHandle } from "@/features/creator/domain/creator-navigation";
import { loadSeoCreator } from "@/server/seo/public-content";
import { notFound } from "next/navigation";

export default async function QuizEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : undefined);
  if (!isCreatorHandle(slug)) notFound();
  const celebrity = await loadSeoCreator(slug, locale);
  if (!celebrity) notFound();
  const returnTo = sanitizeLiveReturnTo(typeof query.returnTo === "string" ? query.returnTo : undefined);
  return <QuizEntryScreen locale={locale} slug={slug} returnTo={returnTo} />;
}
