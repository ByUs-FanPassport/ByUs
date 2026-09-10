import {
  createReauthenticationDependencies, reauthenticationUnavailableResponse,
} from "../../../../../../server/auth/apple-notifications/reauthentication-dependencies";
import { startReauthentication } from "../../../../../../server/auth/apple-notifications/reauthentication-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await startReauthentication(request, createReauthenticationDependencies());
  } catch {
    return reauthenticationUnavailableResponse();
  }
}
