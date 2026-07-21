import { createFanOperationsRouteDependencies, fanOperationsUnavailable } from "../../../../server/g5/fan-operations-route-dependencies";
import { createGetFansHandler } from "../../../../server/g5/fan-operations-route";
export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response>{try{return createGetFansHandler(createFanOperationsRouteDependencies())(request);}catch{return fanOperationsUnavailable();}}
