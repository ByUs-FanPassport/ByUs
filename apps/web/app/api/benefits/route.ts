import { createBenefitRouteDependencies, benefitsUnavailableResponse } from "../../../server/g4/benefit-route-dependencies";
import { createGetBenefitsHandler } from "../../../server/g4/benefit-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return createGetBenefitsHandler(createBenefitRouteDependencies())(request); }
  catch { return benefitsUnavailableResponse(); }
}
