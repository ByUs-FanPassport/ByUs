import {
  createLiveSurveyRouteDependencies,
  liveSurveyUnavailableResponse,
} from "../../../../../server/g3/live-survey-route-dependencies";
import {
  createGetLiveSurveyHandler,
  createPostLiveSurveySubmitHandler,
  createPutLiveSurveyDraftHandler,
} from "../../../../../server/g3/live-survey-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

async function run(request: Request, context: Context, method: "GET" | "PUT" | "POST"): Promise<Response> {
  try {
    const dependencies = createLiveSurveyRouteDependencies();
    const { slug } = await context.params;
    const handler = method === "GET"
      ? createGetLiveSurveyHandler(dependencies)
      : method === "PUT"
        ? createPutLiveSurveyDraftHandler(dependencies)
        : createPostLiveSurveySubmitHandler(dependencies);
    return handler(request, { slug });
  } catch { return liveSurveyUnavailableResponse(); }
}

export const GET = (request: Request, context: Context) => run(request, context, "GET");
export const PUT = (request: Request, context: Context) => run(request, context, "PUT");
export const POST = (request: Request, context: Context) => run(request, context, "POST");
