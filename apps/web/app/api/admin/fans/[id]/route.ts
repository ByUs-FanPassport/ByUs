import { createFanOperationsRouteDependencies, fanOperationsUnavailable } from "../../../../../server/g5/fan-operations-route-dependencies";
import { createGetFanDetailHandler } from "../../../../../server/g5/fan-operations-route";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{try{const {id}=await context.params;return createGetFanDetailHandler(createFanOperationsRouteDependencies())(request,{fanId:id});}catch{return fanOperationsUnavailable();}}
