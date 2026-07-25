import { QuizQuestionsScreen } from "../../../../../features/quiz/ui/quiz-questions-screen";
import { sanitizeLocale } from "../../../../../components/login-intent";

export default async function QuizQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : undefined);
  return <QuizQuestionsScreen locale={locale} slug={slug} />;
}
