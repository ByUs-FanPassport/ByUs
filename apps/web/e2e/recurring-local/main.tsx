import { createRoot } from "react-dom/client";
import { LiveCalendarScreen } from "../../features/live/ui/live-calendar-screen";
import { LiveEventScreen } from "../../features/live/ui/live-event-screen";
import { LiveCatalogScreen } from "../../features/live/ui/live-catalog-screen";
import { LiveManager } from "../../components/admin/live-manager";
import { RecurringLivePanel } from "../../components/admin/recurring-live-panel";
import { buildLiveCalendarMonth } from "../../features/live/domain/live-calendar";
import type { LiveEventResponse } from "../../features/live/domain/live-event";
import "../../app/globals.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en" ? "en" : "ko";
const ko = locale === "ko";
const creator = { slug: "ifewknow", name: ko ? "이퓨" : "IfeW", image: "/images/guest-home/elina-card.jpg", fanCount: 100 };
const dates = ["2026-09-14T22:00:00.000Z", "2026-09-30T22:00:00.000Z", "2026-10-22T22:00:00.000Z"];
const events: LiveEventResponse[] = dates.map((startsAt,index)=>({
  live: { id: `91000000-0000-4000-8000-00000000000${index}`, slug:`ifew-recurring-${index}`, liveType:"recurring", attendanceConfigured:false,
    title:ko?"이퓨 정기 방송":"IfeW recurring LIVE",description:ko?"공식 채널의 정기 방송 일정입니다.":"The recurring schedule from the official channel.",
    startsAt,endsAt:null,brand:null,productContext:null,reservationOpensAt:"2026-09-13T00:00:00.000Z",reservationClosesAt:startsAt,effectiveStatus:"scheduled",
    celebrity:creator,heroImage:{url:creator.image,alt:creator.name},watch:{available:false,provider:"tiktok",url:"https://www.tiktok.com/@ifewknow/live"},missionsAvailable:false,
  },viewer:{authenticated:false,passport:"missing",reservation:null},primaryAction:"sign_in_to_reserve",
}));
const month=params.get("month")==="2026-10"?"2026-10":"2026-09";
const calendar=buildLiveCalendarMonth({month,events:events.map(({live})=>({id:live.id,slug:live.slug,startsAt:live.startsAt,effectiveStatus:live.effectiveStatus,title:live.title,celebrity:{name:creator.name,image:creator.image},reservationState:null,hasBenefit:null}))});
const response=events[0]!;
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  if(url.startsWith('/api/live-events/ifew-recurring-')) return Response.json(response);
  if(url === '/api/admin/lives') return Response.json({lives:[{id:response.live.id,slug:response.live.slug,liveType:"recurring",celebrityId:"11111111-1111-4111-8111-111111111111",brandId:null,publicationStatus:"published",effectiveStatus:"scheduled",startsAt:response.live.startsAt,endsAt:null,reservationOpensAt:response.live.reservationOpensAt,reservationClosesAt:response.live.reservationClosesAt,attendanceValidFrom:null,attendanceValidUntil:null,scheduleRevision:1,everPublishedAt:"2026-09-13T00:00:00Z",liveProvider:"tiktok",externalLiveUrl:response.live.watch.url,youtubeUrl:response.live.watch.url,heroUrl:creator.image,fanCodeConfigured:false,archivedAt:null,archiveReason:null,preview:null,localizations:{ko:{title:"이퓨 정기 방송",summary:"정기 방송",heroAlt:"이퓨"},en:{title:"IfeW recurring LIVE",summary:"Recurring LIVE",heroAlt:"IfeW"}},overrides:[]}],celebrities:[{id:"11111111-1111-4111-8111-111111111111",slug:"ifewknow",status:"published",nameKo:"이퓨",nameEn:"IfeW"}],brands:[],rewardSettings:[],journeyRequirements:[]});
  if(url.startsWith('/api/admin/recurring-lives')) return Response.json({reviews:[],roster:{celebrities:[{id:"11111111-1111-4111-8111-111111111111",slug:"ifewknow",nameKo:"이퓨",nameEn:"IfeW",latestObservation:{result:"regular",verification:"verified",observedAt:"2026-09-13T13:23:00Z"}}]}});
  return originalFetch(input,init);
};
document.documentElement.lang=locale;
const token=async()=>"local-synthetic";
createRoot(document.getElementById("root")!).render(location.pathname==='/admin/lives'?<LiveManager locale={locale} role="admin"/>:location.pathname.startsWith('/admin')?<RecurringLivePanel locale={locale} role="viewer" getAccessToken={token}/>:location.pathname==='/live/calendar'?<LiveCalendarScreen initialCalendar={calendar} locale={locale} celebrities={[creator]} eventMetadata={events.map(({live})=>({eventSlug:live.slug,celebritySlug:creator.slug,platforms:["tiktok"]}))} initialCelebritySlugs={[creator.slug]}/>:location.pathname==='/live'?<LiveCatalogScreen initialCatalog={{liveNow:[],upcoming:events,replay:[]}} locale={locale}/>:<LiveEventScreen slug={response.live.slug} locale={locale} initialData={response}/>);
