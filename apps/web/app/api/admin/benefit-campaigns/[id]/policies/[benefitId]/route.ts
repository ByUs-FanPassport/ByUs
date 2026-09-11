import { createRafflePolicyHandler, raffleOperationsUnavailable } from "@/server/g5/benefit-raffle-operations";
import { createRaffleOperationsDependencies } from "@/server/g5/benefit-raffle-operations-dependencies";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ id: string; benefitId: string }> }) {
  try { const { id, benefitId } = await context.params; return createRafflePolicyHandler(createRaffleOperationsDependencies())(request, { campaignId: id, benefitId }); }
  catch { return raffleOperationsUnavailable(); }
}
export const GET = handle;
export const POST = handle;
