import {
  createQuizAttemptHandlerDependencies,
  quizAttemptUnavailableResponse,
} from "../../../../server/g2/quiz-attempt-route-dependencies";
import { createGetQuizAttemptHandler } from "../../../../server/g2/quiz-attempt-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const dependencies = createQuizAttemptHandlerDependencies();
    const { id } = await context.params;
    return createGetQuizAttemptHandler(dependencies)(request, { attemptId: id });
  } catch {
    return quizAttemptUnavailableResponse();
  }
}
