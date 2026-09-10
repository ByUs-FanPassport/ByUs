import { QuizQuestionsScreen } from "../../../../../features/quiz/ui/quiz-questions-screen";
import { sanitizeLiveReturnTo } from "../../../../../features/quiz/domain/live-return-context";
import { sanitizeLocale } from "../../../../../components/login-intent";

export default async function QuizQuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locale?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : undefined);
  const returnTo = sanitizeLiveReturnTo(typeof query.returnTo === "string" ? query.returnTo : undefined);
  return <QuizQuestionsScreen locale={locale} slug={slug} returnTo={returnTo} />;
}
