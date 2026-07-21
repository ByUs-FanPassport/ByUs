import { createBlockchainJobRouteDependencies } from "../../../../server/g5/blockchain-job-route-dependencies";
import { createGetBlockchainJobsHandler } from "../../../../server/g5/blockchain-job-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return createGetBlockchainJobsHandler(createBlockchainJobRouteDependencies())(request);
}
