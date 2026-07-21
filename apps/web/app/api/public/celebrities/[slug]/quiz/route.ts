import { createPublicQuizIntroRepositoryFromEnvironment } from "../../../../../../server/g2/public-quiz-intro-repository";
import { createPublicQuizIntroHandler } from "../../../../../../server/g2/public-quiz-intro-route";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const repository = createPublicQuizIntroRepositoryFromEnvironment();
    const { slug } = await context.params;
    return createPublicQuizIntroHandler(repository)(request, { slug });
  } catch {
    return Response.json(
      { error: "content_unavailable" },
      {
        status: 503,
        headers: {
          "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }
}
