import { createGetOwnedRafflesHandler, raffleResultUnavailable } from "@/server/raffle/raffle-result-route";
import { createRaffleResultRouteDependencies } from "@/server/raffle/raffle-result-route-dependencies";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return createGetOwnedRafflesHandler(createRaffleResultRouteDependencies())(request); }
  catch { return raffleResultUnavailable(); }
}
