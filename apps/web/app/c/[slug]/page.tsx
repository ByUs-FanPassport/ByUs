import { notFound } from "next/navigation";
import { CelebrityFanPage } from "../../../components/celebrity-fan-page";
import { findPublishedCelebrity, publishedCelebrityFixtures } from "../../../components/public-celebrity-fixtures";

export function generateStaticParams() {
  return publishedCelebrityFixtures.map(({ slug }) => ({ slug }));
}

export default async function CelebrityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const celebrity = findPublishedCelebrity(slug);
  if (!celebrity) notFound();
  return <CelebrityFanPage celebrity={celebrity} />;
}
