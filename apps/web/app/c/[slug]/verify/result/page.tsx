import { notFound } from "next/navigation";
import { z } from "zod";

import { QuizResultScreen } from "../../../../../features/quiz/ui/quiz-result-screen";
import { createPublishedContentRepositoryFromEnvironment } from "../../../../../server/content/published-content-repository";
import { sanitizeLocale } from "../../../../../components/login-intent";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const uuidSchema = z.uuid();

export default async function QuizResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedAttempt = uuidSchema.safeParse(typeof query.attempt === "string" ? query.attempt : undefined);
  const rawPassport = typeof query.passport === "string" ? query.passport : null;
  const parsedPassport = rawPassport === null ? null : uuidSchema.safeParse(rawPassport);
  const locale = sanitizeLocale(typeof query.locale === "string" ? query.locale : undefined);

  if (!parsedSlug.success) {
    notFound();
  }
  const celebrity = await createPublishedContentRepositoryFromEnvironment().findBySlug(locale, parsedSlug.data);

  return (
    <QuizResultScreen
      celebritySlug={parsedSlug.data}
      celebrityName={celebrity?.name ?? (locale === "ko" ? "최애" : "your favorite")}
      locale={locale}
      attemptId={parsedAttempt.success ? parsedAttempt.data : null}
      passportId={parsedPassport?.success ? parsedPassport.data : null}
    />
  );
}
