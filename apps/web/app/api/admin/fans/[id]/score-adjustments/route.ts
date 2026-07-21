import { createFanOperationsRouteDependencies, fanOperationsUnavailable } from "../../../../../../server/g5/fan-operations-route-dependencies";
import { createAdjustFanScoreHandler } from "../../../../../../server/g5/fan-operations-route";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{try{const {id}=await context.params;return createAdjustFanScoreHandler(createFanOperationsRouteDependencies())(request,{fanId:id});}catch{return fanOperationsUnavailable();}}
