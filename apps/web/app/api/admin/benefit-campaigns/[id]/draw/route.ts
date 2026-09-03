import { createBenefitDrawRouteDependencies } from "../../../../../../server/g5/benefit-draw-route-dependencies";
import { createPostBenefitDrawHandler } from "../../../../../../server/g5/benefit-draw-route";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return createPostBenefitDrawHandler(createBenefitDrawRouteDependencies())(request, { campaignId: id });
}
