import {
  createMyRewardRouteDependencies,
  myRewardUnavailableResponse,
} from "../../../../server/g4/my-reward-route-dependencies";
import { createMyRewardsHandler } from "../../../../server/g4/my-reward-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return createMyRewardsHandler(createMyRewardRouteDependencies())(request);
  } catch {
    return myRewardUnavailableResponse();
  }
}
