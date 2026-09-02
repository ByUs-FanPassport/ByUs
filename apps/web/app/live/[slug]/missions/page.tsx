import { LiveMissionScreen } from "../../../../features/live/ui/live-mission-screen";
export default async function Page({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<{locale?:string}>}){const {slug}=await params;const {locale}=await searchParams;return <LiveMissionScreen slug={slug} locale={locale==="en"?"en":"ko"}/>;}

