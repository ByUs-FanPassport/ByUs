import { createPostRaffleRosterHandler, raffleOperationsUnavailable } from "@/server/g5/benefit-raffle-operations";
import { createRaffleOperationsDependencies } from "@/server/g5/benefit-raffle-operations-dependencies";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return createPostRaffleRosterHandler(createRaffleOperationsDependencies())(request, { campaignId: id }); }
  catch { return raffleOperationsUnavailable(); }
}
