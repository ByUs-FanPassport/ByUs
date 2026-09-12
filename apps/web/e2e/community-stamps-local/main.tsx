import { CelebrityMiniCalendar } from "../../features/fanpage/ui/celebrity-calendar";
import type { PublishedCelebrity } from "../../server/content/content-domain";
import { createRoot } from "react-dom/client";
import { CommunityStampCollection } from "../../features/community-stamps/ui/community-stamp-collection";
import { useCommunityStamps } from "../../features/community-stamps/ui/use-community-stamps";
import "../../app/globals.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
const locale = new URLSearchParams(location.search).get("locale") === "en" ? "en" : "ko";
document.documentElement.lang = locale;
function App() { const resource = useCommunityStamps(); return <main style={{maxWidth:1000,margin:"32px auto",padding:"0 20px"}}><h1>MY</h1><CommunityStampCollection resource={resource} locale={locale}/><div style={{maxWidth:420,marginTop:32}}><CelebrityMiniCalendar celebrity={{slug:"elina",name:locale==="ko"?"엘리나":"Elina"} as PublishedCelebrity} locale={locale} upcomingLive={null}/></div></main>; }
createRoot(document.getElementById("root")!).render(<App/>);
