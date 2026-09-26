import { createRoot } from "react-dom/client";
import { useState, type ReactNode } from "react";
import { LoungeScreen } from "../../features/lounge/ui/lounge-screen";
import { CelebrityFanPage } from "../../components/celebrity-fan-page";
import { LoungeMessageManager } from "../../components/admin/lounge-message-manager";
import { FanPostDetail } from "../../features/fan-posts/ui/fan-post-detail";
import { ScheduleDetail } from "../../features/schedules/ui/schedule-detail";
import { ScheduleSuggestionForm } from "../../features/schedules/ui/schedule-suggestion-form";
import { ParticipationRequests } from "../../features/schedules/ui/participation-requests";
import { FanpageRequestForm } from "../../features/fanpage-requests/ui/fanpage-request-form";
import { ParticipationPage } from "../../features/schedules/ui/participation-ui";
import { participationCopy } from "../../i18n/catalogs/features__schedules__ui__participation";
import { FanHistoryScreen } from "../../features/my/ui/fan-history-screen";
import { NotificationCenter } from "../../features/notification/ui/notification-center";
import { SettingsScreen } from "../../features/profile/ui/settings-screen";
import { SharePassport } from "../../features/community-stamps/ui/share-passport";
import { NoticeManager } from "../../components/admin/notice-manager";
import { ContentReportManager } from "../../components/admin/content-report-manager";
import { BlockedUsers } from "../../features/content-safety/ui/blocked-users";
import { AuthorizedScheduleManager } from "../../components/admin/schedule-manager";
import { AuthorizedScheduleSuggestionManager } from "../../components/admin/schedule-suggestion-manager";
import { AuthorizedFanpageRequestManager } from "../../components/admin/fanpage-request-manager";
import "../../app/globals.css";

const params = new URLSearchParams(location.search);
const locale: "ko" | "en" = params.get("locale") === "en" ? "en" : "ko";
const celebrity = { slug: "elina", locale, name: locale === "ko" ? "엘리나" : "Elina", summary: "엘리나 팬페이지", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina", position: "center" }, roles: ["creator"] as const, themes: [], socialLinks: [{ platform: "instagram" as const, url: "https://www.instagram.com/elina_4_22/" }], displayOrder: 0, fanCount: 0 } as const;
const communityMode = (import.meta.env as unknown as Record<string, string | undefined>).VITE_COMMUNITY_MODE === "true";
const fanWebMode = (import.meta.env as unknown as Record<string, string | undefined>).VITE_FAN_WEB_MODE === "true";
const fanWebPath = /^\/(?:c\/elina\/(?:community\/|schedule-suggestions)|live\/calendar\/schedules\/|bias\/requests|my\/(?:activity|requests)|settings\/blocked-users|admin\/(?:schedules|schedule-suggestions|fanpage-requests))/.test(location.pathname);

function AccountSwitcher({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState(() => localStorage.getItem("lounge-test-identity") ?? "guest");
  return <><aside aria-label="Local test account"><label htmlFor="local-account">Account</label>{" "}<select id="local-account" value={identity} onChange={event => {
    const value = event.currentTarget.value; localStorage.setItem("lounge-test-identity", value); setIdentity(value); window.dispatchEvent(new Event("lounge-identity"));
  }}><option value="guest">Guest</option><option value="fan">Fan</option><option value="other">Other fan</option><option value="admin">Admin</option><option value="viewer">Admin viewer</option></select></aside>{children}</>;
}

function fanWebScreen() {
  const detail = location.pathname.match(/^\/c\/elina\/community\/([0-9a-f-]{36})$/);
  const schedule = location.pathname.match(/^\/live\/calendar\/schedules\/([0-9a-f-]{36})$/);
  if (detail) return <FanPostDetail postId={detail[1]} locale={locale} />;
  if (schedule) return <ScheduleDetail id={schedule[1]} locale={locale} />;
  if (location.pathname === "/c/elina/schedule-suggestions") return <ParticipationPage locale={locale} title={participationCopy(locale).suggest} path="/live"><ScheduleSuggestionForm celebritySlug="elina" locale={locale} /></ParticipationPage>;
  if (location.pathname === "/bias/requests") return <ParticipationPage locale={locale} title={participationCopy(locale).fanpage} path="/discover"><FanpageRequestForm locale={locale} initialName={params.get("name")?.slice(0, 120)} /></ParticipationPage>;
  if (location.pathname === "/my/requests") return <ParticipationRequests locale={locale} initialTab={params.get("tab") === "fanpages" ? "fanpages" : "schedules"} highlightId={params.get("item") ?? undefined} />;
  if (location.pathname === "/my/activity") return <FanHistoryScreen locale={locale} kind={params.get("kind") === "collection" ? "collection" : params.get("kind") === "rewards" ? "rewards" : "applications"} />;
  if (location.pathname === "/notifications") return <NotificationCenter />;
  if (location.pathname === "/settings") return <SettingsScreen locale={locale} />;
  if (location.pathname === "/share-passport") return <ParticipationPage locale={locale} title="Fan Passport" path="/my"><SharePassport creator={celebrity} locale={locale} /></ParticipationPage>;
  if (location.pathname === "/admin/notices") return <NoticeManager celebrityId="c7200000-0000-4000-8000-000000000001" celebrityName={celebrity.name} role="operator" locale={locale} />;
  if (location.pathname === "/admin/content-reports") return <ContentReportManager />;
  if (location.pathname === "/settings/blocked-users") return <BlockedUsers locale={locale} />;
  if (location.pathname === "/admin/schedules") return <AuthorizedScheduleManager locale={locale} />;
  if (location.pathname === "/admin/schedule-suggestions") return <AuthorizedScheduleSuggestionManager locale={locale} />;
  if (location.pathname === "/admin/fanpage-requests") return <AuthorizedFanpageRequestManager locale={locale} />;
  const requestedTab = params.get("tab");
  const initialTab = requestedTab === "community" || requestedTab === "media" || requestedTab === "leaderboard" || requestedTab === "notice" || requestedTab === "certifications" ? requestedTab : "home";
  return <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={null} initialTab={initialTab} />;
}

document.documentElement.lang = locale;
const screen = fanWebMode || fanWebPath || params.get("tab") === "community" || params.get("tab") === "media" ? fanWebScreen() : location.pathname.startsWith("/admin") ? <LoungeMessageManager /> : !communityMode && location.pathname.endsWith("/lounge") ? <LoungeScreen celebrity={celebrity} locale={locale} /> : <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={null} initialTab={params.get("tab") === "leaderboard" ? "leaderboard" : "home"} />;
createRoot(document.getElementById("root")!).render(<AccountSwitcher>{screen}</AccountSwitcher>);
