import { createBenefitRouteDependencies, benefitsUnavailableResponse } from "../../../../../server/g4/benefit-route-dependencies";
import { createPostBenefitClaimHandler } from "../../../../../server/g4/benefit-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const { id } = await context.params; return createPostBenefitClaimHandler(createBenefitRouteDependencies())(request, { benefitId: id }); }
  catch { return benefitsUnavailableResponse(); }
}
