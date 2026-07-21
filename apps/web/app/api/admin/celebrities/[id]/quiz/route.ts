import { createContentCmsDependencies } from "../../../../../../server/g5/content-cms-dependencies";
import { quizHandlers } from "../../../../../../server/g5/content-cms-route";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return quizHandlers(createContentCmsDependencies()).GET(request,(await params).id)}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return quizHandlers(createContentCmsDependencies()).POST(request,(await params).id)}
