import { createContentCmsDependencies } from "../../../../server/g5/content-cms-dependencies";
import { celebrityHandlers } from "../../../../server/g5/content-cms-route";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const handlers=()=>celebrityHandlers(createContentCmsDependencies());
export async function GET(request:Request){return handlers().GET(request)}
export async function POST(request:Request){return handlers().POST(request)}

