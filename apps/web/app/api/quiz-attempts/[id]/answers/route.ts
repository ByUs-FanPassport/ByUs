import {
  createQuizAttemptHandlerDependencies,
  quizAttemptUnavailableResponse,
} from "../../../../../server/g2/quiz-attempt-route-dependencies";
import { createSaveQuizAnswerHandler } from "../../../../../server/g2/quiz-attempt-route";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const dependencies = createQuizAttemptHandlerDependencies();
    const { id } = await context.params;
    return createSaveQuizAnswerHandler(dependencies)(request, { attemptId: id });
  } catch {
    return quizAttemptUnavailableResponse();
  }
}
