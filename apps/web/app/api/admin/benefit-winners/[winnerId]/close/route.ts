import { createCloseRaffleClaimHandler, raffleOperationsUnavailable } from "@/server/g5/benefit-raffle-operations";
import { createRaffleOperationsDependencies } from "@/server/g5/benefit-raffle-operations-dependencies";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ winnerId: string }> }) {
  try { return createCloseRaffleClaimHandler(createRaffleOperationsDependencies())(request, await context.params); }
  catch { return raffleOperationsUnavailable(); }
}
