import { QuizQuestionsScreen } from "../../../../../features/quiz/ui/quiz-questions-screen";

export default async function QuizQuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <QuizQuestionsScreen slug={slug} />;
}
