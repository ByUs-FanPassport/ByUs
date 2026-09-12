import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { createInstagramOwnerStartHandler } from "../../../../../server/instagram/owner-routes";
import { privateHeaders } from "../../../../../server/instagram/pages";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function POST(request:Request){try{return await createInstagramOwnerStartHandler(createInstagramDependencies())(request);}catch{return Response.json({error:{code:"INSTAGRAM_UNAVAILABLE"}},{status:503,headers:privateHeaders});}}
