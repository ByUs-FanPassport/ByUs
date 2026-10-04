"use client";
import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__leaderboard-panel";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { Trophy } from "lucide-react";
import { LEADERBOARD_MIN_FANS, leaderboardSchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import { FanGatheringPanel } from "./fan-gathering";
import gatheringStyles from "./fan-gathering.module.css";
import { ResourceMessage } from "./home-panels";
import styles from "./fanpage.module.css";
const parse = (body: unknown) => leaderboardSchema.parse(body);
export function LeaderboardPanel({ slug, locale, showGathering = true }: { slug: string; locale: AppLocale; showGathering?: boolean }) {
  const ko = locale === "ko";
  const { state, retry } = useFanpageResource(`/api/celebrities/${slug}/leaderboard?locale=${toContentLocale(locale)}`, parse);
  const gathering = showGathering ? <FanGatheringPanel slug={slug} locale={locale} /> : null;
  if (state.status === "error" && state.code === "LEADERBOARD_NOT_AVAILABLE") return <>{gathering}<p className={gatheringStyles.rankStatus}>{locale === "ko" ? `함께하는 팬 ${LEADERBOARD_MIN_FANS}명부터 팬점수 리더보드를 공개해요.` : translate(locale, localizedMessages.m178a185dcf7b, "The Fan Score leaderboard opens at 100 fans.")}<span>{locale === "ko" ? `현재 ${state.fanCount ?? state.membershipCount ?? 0}명 / ${LEADERBOARD_MIN_FANS}명` : translate(locale, localizedMessages.m019211255592, "{0} / 100 fans", [state.fanCount ?? state.membershipCount ?? 0])}</span></p></>;
  if (state.status !== "ready") return <>{gathering}<ResourceMessage locale={locale} error={state.status === "error"} retry={retry} /></>;
  return <>{gathering}<section className={styles.leaderboard}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>FAN LEADERBOARD</p><h2><Trophy aria-hidden="true" />{locale === "ko" ? "함께 쌓은 팬 활동의 순위" : translate(locale, localizedMessages.mc0a4ccdf090d, "Your fan activity, ranked")}</h2></div><span>TOP 100</span></div><p className={styles.intro}>{locale === "ko" ? "누적 팬점수 기준 · 동점이면 패스포트 발급 시각, 패스포트가 없으면 참여 시각이 빠른 팬이 앞서요." : translate(locale, localizedMessages.m01cd18e08921, "Lifetime Fan Score · Ties use Passport issuance time, or participation time for fans without one.")}</p>
    {state.data.me && <div className={styles.myRank}><span>{locale === "ko" ? "내 순위" : translate(locale, localizedMessages.m0c416452a30e, "My rank")}</span><strong>{state.data.me.rank}{ko ? "위" : ""}</strong><img src={state.data.me.avatarUrl} width={44} height={44} alt="" /><b>{state.data.me.nickname}</b><strong>{state.data.me.points}{locale === "ko" ? "점" : translate(locale, localizedMessages.m5a9d59babd7a, " pts")}</strong></div>}
    <table><caption className={styles.srOnly}>{locale === "ko" ? "팬점수 상위 100명" : translate(locale, localizedMessages.me3c0cbcd4819, "Top 100 fans")}</caption><thead><tr><th scope="col">{locale === "ko" ? "순위" : translate(locale, localizedMessages.m571a4229f7f8, "Rank")}</th><th scope="col">{locale === "ko" ? "팬" : translate(locale, localizedMessages.m9d49652f660e, "Fan")}</th><th scope="col">{locale === "ko" ? "팬점수" : translate(locale, localizedMessages.m6323df1ec8f1, "Fan Score")}</th></tr></thead><tbody>{state.data.rows.map((row) => <tr key={row.rank}><td>{row.rank <= 3 && <Trophy aria-hidden="true" />}{row.rank}</td><td><div className={styles.rankedFan}><img src={row.avatarUrl} width={40} height={40} alt="" /><strong>{row.nickname}</strong></div></td><td>{row.points.toLocaleString(locale)}</td></tr>)}</tbody></table><p className={styles.muted}>{locale === "ko" ? "집계 기준" : translate(locale, localizedMessages.m9f47b9144046, "As of")} <time dateTime={state.data.asOf}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(state.data.asOf))}</time></p>
  </section></>;
}
