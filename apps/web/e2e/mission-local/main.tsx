import { createRoot } from "react-dom/client";

import { LiveMissionScreen } from "../../features/live/ui/live-mission-screen";
import { ElinaMissionEntry } from "../../features/live/ui/elina-mission-entry";
import { FanAppFrame, FanContentContainer } from "../../components/fan-shell/fan-app-shell";
import "../../app/globals.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

const params = new URLSearchParams(location.search);
const locale: "ko" | "en" = params.get("locale") === "en" ? "en" : "ko";

document.documentElement.lang = locale;
createRoot(document.getElementById("root")!).render(location.pathname === "/entry"
  ? <FanAppFrame locale={locale} mainId="mission-entry-main" currentPath="/c/elina">
      <FanContentContainer as="main" id="mission-entry-main" tabIndex={-1}>
        <ElinaMissionEntry celebritySlug="elina" locale={locale} />
      </FanContentContainer>
    </FanAppFrame>
  : <LiveMissionScreen slug="elina-banksy-instagram-20260918" locale={locale} />,
);
