"use client";
import { Trophy, LockKeyhole } from "lucide-react";
import { leaderboardSchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import { ResourceMessage } from "./home-panels";
import styles from "./fanpage.module.css";
const parse = (body: unknown) => leaderboardSchema.parse(body);
export function LeaderboardPanel({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const ko = locale === "ko";
  const { state, retry } = useFanpageResource(`/api/celebrities/${slug}/leaderboard?locale=${locale}`, parse);
  if (state.status === "error" && state.code === "LEADERBOARD_NOT_AVAILABLE") return <section className={styles.locked}><LockKeyhole aria-hidden="true" /><p className={styles.eyebrow}>{ko ? "리더보드 · 집계 중" : "Leaderboard · counting"}</p><h2>{ko ? "팬들이 모이면 순위가 열려요." : "The leaderboard opens as fans join."}</h2><p>{ko ? "ByUs 패스포트 보유 팬이 501명이 되면 누적 팬점수 Top 100과 내 순위를 확인할 수 있어요." : "At 501 ByUs Passport holders, see the lifetime Fan Score Top 100 and your rank."}</p><strong>{ko ? `현재 ${state.membershipCount ?? 0}명 / 501명` : `${state.membershipCount ?? 0} / 501 fans`}</strong></section>;
  if (state.status !== "ready") return <ResourceMessage locale={locale} error={state.status === "error"} retry={retry} />;
  return <section className={styles.leaderboard}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>FAN LEADERBOARD</p><h2><Trophy aria-hidden="true" />{ko ? "함께 쌓은 팬 활동의 순위" : "Your fan activity, ranked"}</h2></div><span>TOP 100</span></div><p className={styles.intro}>{ko ? "누적 팬점수 기준 · 동점일 때는 패스포트를 먼저 만든 팬이 앞서요." : "Lifetime Fan Score · Earlier Passport issuance breaks ties."}</p>
    {state.data.me && <div className={styles.myRank}><span>{ko ? "내 순위" : "My rank"}</span><strong>{state.data.me.rank}{ko ? "위" : ""}</strong><img src={state.data.me.avatarUrl} width={44} height={44} alt="" /><b>{state.data.me.nickname}</b><strong>{state.data.me.points}{ko ? "점" : " pts"}</strong></div>}
    <table><caption className={styles.srOnly}>{ko ? "팬점수 상위 100명" : "Top 100 fans"}</caption><thead><tr><th scope="col">{ko ? "순위" : "Rank"}</th><th scope="col">{ko ? "팬" : "Fan"}</th><th scope="col">{ko ? "팬점수" : "Fan Score"}</th></tr></thead><tbody>{state.data.rows.map((row) => <tr key={row.rank}><td>{row.rank <= 3 && <Trophy aria-hidden="true" />}{row.rank}</td><td><img src={row.avatarUrl} width={40} height={40} alt="" /><strong>{row.nickname}</strong></td><td>{row.points.toLocaleString(ko ? "ko-KR" : "en-US")}</td></tr>)}</tbody></table><p className={styles.muted}>{ko ? "집계 기준" : "As of"} <time dateTime={state.data.asOf}>{new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(state.data.asOf))}</time></p>
  </section>;
}
