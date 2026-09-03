import {
  createGetJourneyHandler,
  createJourneyRouteDependencies,
  createPostJourneyHandler,
  journeyUnavailableResponse,
} from "../../../../../server/journey/journey-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const dependencies = createJourneyRouteDependencies();
    const { slug } = await context.params;
    return createGetJourneyHandler(dependencies)(request, { slug });
  } catch {
    return journeyUnavailableResponse();
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const dependencies = createJourneyRouteDependencies();
    const { slug } = await context.params;
    return createPostJourneyHandler(dependencies)(request, { slug });
  } catch {
    return journeyUnavailableResponse();
  }
}
