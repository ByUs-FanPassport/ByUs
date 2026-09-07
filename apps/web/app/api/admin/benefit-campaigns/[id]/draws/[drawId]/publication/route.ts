import { createBenefitDrawRouteDependencies } from "@/server/g5/benefit-draw-route-dependencies";
import { createPublishBenefitDrawHandler } from "@/server/g5/benefit-draw-route";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; drawId: string }> },
) {
  const { id, drawId } = await context.params;
  return createPublishBenefitDrawHandler(createBenefitDrawRouteDependencies())(
    request,
    { campaignId: id, drawId },
  );
}
