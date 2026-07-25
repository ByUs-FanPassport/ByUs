import { QuizEntryScreen } from "../../../../features/quiz/ui/quiz-entry-screen";
import { sanitizeLocale } from "../../../../components/login-intent";

export default async function QuizEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : undefined);
  return <QuizEntryScreen locale={locale} slug={slug} />;
}
