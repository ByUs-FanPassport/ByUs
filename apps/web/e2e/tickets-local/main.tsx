import { createRoot } from "react-dom/client";
import { FanAppFrame, FanContentContainer } from "../../components/fan-shell/fan-app-shell";
import { FanTicketGuide } from "../../features/tickets/ui/fan-ticket-guide";
import { FanTicketHistoryScreen } from "../../features/tickets/ui/fan-ticket-history-screen";
import fanpageStyles from "../../features/fanpage/ui/fanpage.module.css";
import { CheerComments } from "../../features/fanpage/ui/cheer-comments";
import "../../app/globals.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

const query = new URLSearchParams(location.search);
const locale = query.get("locale") === "en" ? "en" : "ko";
const name = locale === "ko" ? "엘리나" : "Elina";
document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(location.pathname === "/typography"
  ? <FanAppFrame locale={locale} mainId="guide"><FanContentContainer as="main" id="guide" tabIndex={-1} style={{ paddingBlock: 32, display: "grid", gap: 24 }}><FanTicketGuide creatorSlug="elina" creatorName={name} locale={locale} /><CheerComments slug="elina" name={name} locale={locale} /></FanContentContainer></FanAppFrame>
  : location.pathname === "/home"
  ? <FanAppFrame locale={locale} mainId="guide"><FanContentContainer as="main" id="guide" tabIndex={-1} style={{ paddingBlock: 32 }}><div className={fanpageStyles.content}><FanTicketGuide creatorSlug="elina" creatorName={name} locale={locale} compact /><div className={fanpageStyles.homeGrid} data-testid="home-content"><section className={fanpageStyles.mainColumn}><h2>{locale === "ko" ? "최근 활동" : "Recent activity"}</h2></section><section className={fanpageStyles.cheerPreview}><h2>{locale === "ko" ? "응원댓글" : "Cheers"}</h2></section></div></div></FanContentContainer></FanAppFrame>
  : location.pathname === "/history"
  ? <FanTicketHistoryScreen creatorSlug="elina" creatorName={name} locale={locale} />
  : <FanAppFrame locale={locale} mainId="guide"><FanContentContainer as="main" id="guide" tabIndex={-1} style={{ paddingBlock: 32 }}><FanTicketGuide creatorSlug="elina" creatorName={name} locale={locale} compact={query.get("compact") === "1"} /></FanContentContainer></FanAppFrame>);
