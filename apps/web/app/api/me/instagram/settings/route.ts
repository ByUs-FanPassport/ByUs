import { createInstagramDependencies } from "../../../../../server/instagram/dependencies";
import { createInstagramOwnerSettingsHandler } from "../../../../../server/instagram/owner-routes";
import { privateHeaders } from "../../../../../server/instagram/pages";
export const dynamic="force-dynamic";export const runtime="nodejs";
export async function POST(request:Request){try{return await createInstagramOwnerSettingsHandler(createInstagramDependencies({allowDisabled:true}))(request);}catch{return Response.json({error:{code:"INSTAGRAM_UNAVAILABLE"}},{status:503,headers:privateHeaders});}}
