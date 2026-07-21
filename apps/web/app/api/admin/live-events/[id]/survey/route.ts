import { createSurveyBuilderRouteDependencies } from "../../../../../../server/g5/survey-builder-route-dependencies";
import { createGetSurveyBuilderHandler, createWriteSurveyBuilderHandler } from "../../../../../../server/g5/survey-builder-route";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return createGetSurveyBuilderHandler(createSurveyBuilderRouteDependencies())(request,{liveEventId:(await params).id})}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return createWriteSurveyBuilderHandler(createSurveyBuilderRouteDependencies())(request,{liveEventId:(await params).id})}
