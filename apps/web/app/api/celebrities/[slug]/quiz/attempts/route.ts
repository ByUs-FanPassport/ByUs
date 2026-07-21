import {
  createQuizAttemptHandlerDependencies,
  quizAttemptUnavailableResponse,
} from "../../../../../../server/g2/quiz-attempt-route-dependencies";
import { createStartQuizAttemptHandler } from "../../../../../../server/g2/quiz-attempt-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const dependencies = createQuizAttemptHandlerDependencies();
    const { slug } = await context.params;
    return createStartQuizAttemptHandler(dependencies)(request, { celebritySlug: slug });
  } catch {
    return quizAttemptUnavailableResponse();
  }
}
