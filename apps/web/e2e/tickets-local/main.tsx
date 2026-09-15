import { createRoot } from "react-dom/client";
import { FanAppFrame, FanContentContainer } from "../../components/fan-shell/fan-app-shell";
import { FanTicketGuide } from "../../features/tickets/ui/fan-ticket-guide";
import { FanTicketHistoryScreen } from "../../features/tickets/ui/fan-ticket-history-screen";
import "../../app/globals.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

const query = new URLSearchParams(location.search);
const locale = query.get("locale") === "en" ? "en" : "ko";
const name = locale === "ko" ? "엘리나" : "Elina";
document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(location.pathname === "/history"
  ? <FanTicketHistoryScreen creatorSlug="elina" creatorName={name} locale={locale} />
  : <FanAppFrame locale={locale} mainId="guide"><FanContentContainer as="main" id="guide" tabIndex={-1} style={{ paddingBlock: 32 }}><FanTicketGuide creatorSlug="elina" creatorName={name} locale={locale} compact={query.get("compact") === "1"} /></FanContentContainer></FanAppFrame>);
