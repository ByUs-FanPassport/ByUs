import { createPassportReadRouteDependencies, passportReadUnavailableResponse } from "../../../../server/g4/passport-read-route-dependencies";
import { createPassportDetailHandler } from "../../../../server/g4/passport-read-route";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try { const { id } = await context.params; return createPassportDetailHandler(createPassportReadRouteDependencies())(request, { passportId: id }); }
  catch { return passportReadUnavailableResponse(); }
}

