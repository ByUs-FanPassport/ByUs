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
import { MyScreen } from "../../features/my/ui/my-screen";
import { BenefitDetailOverlay, BenefitDetailScreen } from "../../features/benefit/ui/benefit-screen";
import { BenefitRecipientScreen } from "../../features/benefit/ui/benefit-recipient-screen";
import { SharedPassportLanding } from "../../features/community-stamps/ui/shared-passport-landing";
import {
  benefitFixture,
  benefitResultFixture,
  recipientDetailsFixture,
  recipientRewardsFixture,
  recipientWinnerId,
  sharedPassportActivityFixture,
  sharedPassportToken,
} from "./benefit-fixture";
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
import { QuizQuestionsScreen } from "../../features/quiz/ui/quiz-questions-screen";
import { QuizResultScreen } from "../../features/quiz/ui/quiz-result-screen";
import { LiveSurveyScreen } from "../../features/live/ui/live-survey-screen";
import { FanAppFrame, FanContentContainer } from "../../components/fan-shell/fan-app-shell";
import { ChzzkPostBody } from "../../features/fanpage/ui/chzzk-posts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import noticeStyles from "../../components/notice/notice-detail.module.css";
import { discoveryChzzkPost, discoveryFixtureResponse, discoveryIds } from "./discovery-fixture";
import "../../app/globals.css";

const params = new URLSearchParams(location.search);
const locale: "ko" | "en" = params.get("locale") === "en" ? "en" : "ko";
const celebrity = { slug: "elina", locale, name: locale === "ko" ? "엘리나" : "Elina", summary: "엘리나 팬페이지", image: { url: "/images/guest-home/elina-card.jpg", alt: "Elina", position: "center" }, roles: ["creator"] as const, themes: [], socialLinks: [{ platform: "instagram" as const, url: "https://www.instagram.com/elina_4_22/" }], displayOrder: 0, fanCount: 0 } as const;
const communityMode = (import.meta.env as unknown as Record<string, string | undefined>).VITE_COMMUNITY_MODE === "true";
const fanWebMode = (import.meta.env as unknown as Record<string, string | undefined>).VITE_FAN_WEB_MODE === "true";
const fanWebPath = /^\/(?:c\/elina\/(?:community\/|schedule-suggestions|updates\/chzzk\/|verify\/(?:questions|result))|live\/(?:calendar\/schedules\/|discovery-survey\/survey)|bias\/requests|my\/(?:activity|requests|rewards\/[0-9a-f-]{36}\/recipient)|s\/[a-f0-9]{32}|settings\/blocked-users|admin\/(?:schedules|schedule-suggestions|fanpage-requests))/.test(location.pathname);

function AccountSwitcher({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState(() => localStorage.getItem("lounge-test-identity") ?? "guest");
  return <><aside aria-label="Local test account"><label htmlFor="local-account">Account</label>{" "}<select id="local-account" value={identity} onChange={event => {
    const value = event.currentTarget.value; localStorage.setItem("lounge-test-identity", value); setIdentity(value); window.dispatchEvent(new Event("lounge-identity"));
  }}><option value="guest">Guest</option><option value="fan">Fan</option><option value="other">Other fan</option><option value="admin">Admin</option><option value="viewer">Admin viewer</option></select></aside>{children}</>;
}

function fanWebScreen() {
  const detail = location.pathname.match(/^\/c\/elina\/community\/([0-9a-f-]{36})$/);
  const schedule = location.pathname.match(/^\/live\/calendar\/schedules\/([0-9a-f-]{36})$/);
  if (detail) return <FanAppFrame locale={locale} mainId="fan-post-main"><FanContentContainer as="main" id="fan-post-main" tabIndex={-1} style={{ paddingBlock: 32 }}><FanPostDetail postId={detail[1]} locale={locale} /></FanContentContainer></FanAppFrame>;
  if (schedule) return <ScheduleDetail id={schedule[1]} locale={locale} />;
  if (/^\/c\/elina\/updates\/chzzk\/[1-9]\d{0,14}$/.test(location.pathname)) return <FanAppFrame locale={locale} mainId="chzzk-detail-main"><FanContentContainer as="main" id="chzzk-detail-main" className={`${noticeStyles.page} ${noticeStyles.standalone}`} tabIndex={-1}><Link className={noticeStyles.back} href={`/elina?tab=notice&locale=${locale}#celebrity-content`}><ArrowLeft aria-hidden="true" />{locale === "ko" ? "소식 목록" : "All updates"}</Link><article className={noticeStyles.article}><header className={noticeStyles.header}><h1>오늘 방송도 함께해 주셔서 고마워요</h1><div className={noticeStyles.meta}><span>CHZZK</span><time dateTime={discoveryChzzkPost.date}>{discoveryChzzkPost.date.replaceAll("-", ".")}</time></div></header><ChzzkPostBody post={discoveryChzzkPost} name={celebrity.name} locale={locale} communityUrl="https://chzzk.naver.com/0a3f97086cb81d3360c69fdf5d020045/community" /></article></FanContentContainer></FanAppFrame>;
  if (location.pathname === "/c/elina/verify/questions") return <QuizQuestionsScreen slug="elina" locale={locale} />;
  if (location.pathname === "/c/elina/verify/result") return <QuizResultScreen attemptId={params.get("attempt")} passportId={params.get("passport")} celebritySlug="elina" celebrityName={celebrity.name} locale={locale} />;
  if (location.pathname === "/live/discovery-survey/survey") return <LiveSurveyScreen slug="discovery-survey" locale={locale} />;
  if (location.pathname === "/c/elina/schedule-suggestions") return <ParticipationPage locale={locale} title={participationCopy(locale).suggest} path="/live"><ScheduleSuggestionForm celebritySlug="elina" locale={locale} /></ParticipationPage>;
  if (location.pathname === "/bias/requests") return <ParticipationPage locale={locale} title={participationCopy(locale).fanpage} path="/bias/requests"><FanpageRequestForm locale={locale} initialName={params.get("name")?.slice(0, 120)} /></ParticipationPage>;
  if (location.pathname === "/my") return <MyScreen locale={locale} />;
  if (location.pathname === "/benefits/local-preview") return params.get("presentation") === "overlay"
    ? <BenefitDetailOverlay benefitId={benefitFixture.id} locale={locale} celebrity="elina" />
    : <BenefitDetailScreen benefitId={benefitFixture.id} locale={locale} />;
  if (location.pathname === `/my/rewards/${recipientWinnerId}/recipient`) return <BenefitRecipientScreen winnerId={recipientWinnerId} locale={locale} />;
  if (location.pathname === `/s/${sharedPassportToken}`) return <SharedPassportLanding token={sharedPassportToken} creator={celebrity} locale={locale} activity={sharedPassportActivityFixture} />;
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

// Read-only visual fixtures stay inside the standalone loopback harness.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const discoveryResponse = discoveryFixtureResponse(url, method, location.pathname);
  if (discoveryResponse) return Promise.resolve(discoveryResponse);
  if (method === "GET" && location.pathname === "/benefits/local-preview" && url.startsWith(`/api/benefits/${benefitFixture.id}/result?`)) return Promise.resolve(Response.json(benefitResultFixture));
  if (method === "GET" && location.pathname === "/benefits/local-preview" && url.startsWith(`/api/benefits/${benefitFixture.id}?`)) return Promise.resolve(Response.json({ benefit: benefitFixture }));
  if (method === "GET" && location.pathname === `/my/rewards/${recipientWinnerId}/recipient` && url.startsWith("/api/me/rewards?")) return Promise.resolve(Response.json({ rewards: recipientRewardsFixture }));
  if (method === "GET" && location.pathname === `/my/rewards/${recipientWinnerId}/recipient` && url === `/api/me/rewards/${recipientWinnerId}/recipient`) return Promise.resolve(Response.json(recipientDetailsFixture));
  if (method === "GET" && location.pathname === "/my" && url === "/api/community-stamps") return Promise.resolve(Response.json({ stamps: [], today: "2026-09-27" }));
  return originalFetch(input, init);
};

document.documentElement.lang = locale;
const screen = fanWebMode || fanWebPath || params.get("tab") === "community" || params.get("tab") === "media" ? fanWebScreen() : location.pathname.startsWith("/admin") ? <LoungeMessageManager /> : !communityMode && location.pathname.endsWith("/lounge") ? <LoungeScreen celebrity={celebrity} locale={locale} /> : <CelebrityFanPage celebrity={celebrity} locale={locale} upcomingLive={null} initialTab={params.get("tab") === "leaderboard" ? "leaderboard" : "home"} />;
createRoot(document.getElementById("root")!).render(<AccountSwitcher>{screen}</AccountSwitcher>);
