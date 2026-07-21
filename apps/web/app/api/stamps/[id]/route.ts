import { createPassportReadRouteDependencies, passportReadUnavailableResponse } from "../../../../server/g4/passport-read-route-dependencies";
import { createStampDetailHandler } from "../../../../server/g4/passport-read-route";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const { id } = await context.params; return createStampDetailHandler(createPassportReadRouteDependencies())(request, { stampId: id }); }
  catch { return passportReadUnavailableResponse(); }
}
