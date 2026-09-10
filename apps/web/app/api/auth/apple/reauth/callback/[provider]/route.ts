import {
  createReauthenticationDependencies, reauthenticationUnavailableResponse,
} from "../../../../../../../server/auth/apple-notifications/reauthentication-dependencies";
import { completeReauthentication } from "../../../../../../../server/auth/apple-notifications/reauthentication-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function callback(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  try {
    const { provider } = await context.params;
    return await completeReauthentication(request, provider, createReauthenticationDependencies());
  } catch {
    return reauthenticationUnavailableResponse();
  }
}

export const GET = callback;
export const POST = callback;
