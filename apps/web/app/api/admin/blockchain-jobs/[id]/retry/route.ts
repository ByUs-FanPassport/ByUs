import { createBlockchainJobRouteDependencies } from "../../../../../../server/g5/blockchain-job-route-dependencies";
import { createRetryBlockchainJobHandler } from "../../../../../../server/g5/blockchain-job-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  return createRetryBlockchainJobHandler(createBlockchainJobRouteDependencies())(request, { jobId: id });
}
