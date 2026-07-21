import { SurveyBuilder } from "../../../../../components/admin/survey-builder";
export default async function AdminSurveyPage({params}:{params:Promise<{id:string}>}){return <SurveyBuilder liveEventId={(await params).id}/>}
