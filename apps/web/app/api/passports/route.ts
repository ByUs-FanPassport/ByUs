import { createPassportReadRouteDependencies, passportReadUnavailableResponse } from "../../../server/g4/passport-read-route-dependencies";
import { createPassportCollectionHandler } from "../../../server/g4/passport-read-route";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try { return createPassportCollectionHandler(createPassportReadRouteDependencies())(request); }
  catch { return passportReadUnavailableResponse(); }
}

