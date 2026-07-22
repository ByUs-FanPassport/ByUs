import { QuizEntryScreen } from "../../../../features/quiz/ui/quiz-entry-screen";

export default async function QuizEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <QuizEntryScreen slug={slug} />;
}
