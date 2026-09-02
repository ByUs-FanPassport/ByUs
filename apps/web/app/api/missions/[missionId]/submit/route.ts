import { createLiveMissionDependencies } from "../../../../../server/g3/live-mission-route-dependencies";
import { createPostLiveMissionHandler } from "../../../../../server/g3/live-mission-route";
export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{missionId:string}>}){try{return createPostLiveMissionHandler(createLiveMissionDependencies())(request,await context.params);}catch{return Response.json({error:{code:"MISSION_UNAVAILABLE"}},{status:503});}}
