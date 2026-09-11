import { createGetOwnedRaffleResultHandler, raffleResultUnavailable } from "@/server/raffle/raffle-result-route";
import { createRaffleResultRouteDependencies } from "@/server/raffle/raffle-result-route-dependencies";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return createGetOwnedRaffleResultHandler(createRaffleResultRouteDependencies())(request, { benefitId: id });
  } catch { return raffleResultUnavailable(); }
}
