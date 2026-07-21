import { notFound } from "next/navigation";
import { z } from "zod";

import { QuizResultScreen } from "../../../../../features/quiz/ui/quiz-result-screen";

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

  if (!parsedSlug.success) {
    notFound();
  }

  return (
    <QuizResultScreen
      celebritySlug={parsedSlug.data}
      attemptId={parsedAttempt.success ? parsedAttempt.data : null}
      passportId={parsedPassport?.success ? parsedPassport.data : null}
    />
  );
}
