import { createDeploymentFingerprintDependencies } from "../../../../server/g6/deployment-fingerprint-route-dependencies";
import { createDeploymentFingerprintHandler } from "../../../../server/g6/deployment-fingerprint-route";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return createDeploymentFingerprintHandler(createDeploymentFingerprintDependencies())(request);
}
