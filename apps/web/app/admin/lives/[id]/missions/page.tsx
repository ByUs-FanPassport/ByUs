import { MissionBuilder } from "../../../../../components/admin/mission-builder";
export default async function Page({params}:{params:Promise<{id:string}>}){return <MissionBuilder liveEventId={(await params).id}/>;}

