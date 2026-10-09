"use client";

import { useId, useState } from "react";
import { Trophy } from "lucide-react";
import { FanSectionHeader } from "@/components/fan-ui/fan-heading";
import { FanAction } from "@/components/fan-ui/fan-action";
import { Avatar } from "@/features/profile/ui/avatar";
import { toContentLocale, type AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__leaderboard-panel";
import { leaderboardActivityCopy } from "@/i18n/catalogs/features__fanpage__ui__leaderboard-activities";
import { translate } from "@/i18n/messages";
import { LEADERBOARD_CATEGORIES, LEADERBOARD_MIN_FANS, leaderboardSchema } from "../domain/community";
import { fanPageHref } from "../domain/board-navigation";
import { useFanpageResource } from "./use-fanpage-resource";
import { FanGatheringPanel } from "./fan-gathering";
import gatheringStyles from "./fan-gathering.module.css";
import { ResourceMessage } from "./home-panels";
import styles from "./leaderboard-panel.module.css";

const parse = (body: unknown) => leaderboardSchema.parse(body);
const fallbackAvatar = { initialCharacterId: "star-pink", characterId: "star-pink", source: "character", hasImage: false, revision: 0 } as const;

export function LeaderboardPanel({ slug, locale, showGathering = true }: { slug: string; locale: AppLocale; showGathering?: boolean }) {
  const [category, setCategory] = useState<typeof LEADERBOARD_CATEGORIES[number]>("all");
  const resultsId = useId();
  const copy = leaderboardActivityCopy[locale];
  const { state, retry } = useFanpageResource(`/api/celebrities/${slug}/leaderboard?locale=${toContentLocale(locale)}&category=${category}`, parse);

  if (state.status === "error" && state.code === "LEADERBOARD_NOT_AVAILABLE") return <>
    {showGathering && <FanGatheringPanel slug={slug} locale={locale} />}
    <p className={gatheringStyles.rankStatus}>
      {locale === "ko" ? `함께하는 팬 ${LEADERBOARD_MIN_FANS}명부터 팬점수 리더보드를 공개해요.` : translate(locale, localizedMessages.m178a185dcf7b, "The Fan Score leaderboard opens at 100 fans.")}
      <span>{locale === "ko" ? `현재 ${state.fanCount ?? state.membershipCount ?? 0}명 / ${LEADERBOARD_MIN_FANS}명` : translate(locale, localizedMessages.m019211255592, "{0} / 100 fans", [state.fanCount ?? state.membershipCount ?? 0])}</span>
    </p>
  </>;

  return <section className={styles.leaderboard} aria-label={copy.filters}>
    <div className={styles.heading}>
      <FanSectionHeader title={<><Trophy aria-hidden="true" />{locale === "ko" ? "함께 쌓은 팬 활동의 순위" : translate(locale, localizedMessages.mc0a4ccdf090d, "Your fan activity, ranked")}</>} description={copy.intro} />
      <span className={styles.topLabel}>TOP 100</span>
    </div>
    <div className={styles.filters} role="group" aria-label={copy.filters}>
      {LEADERBOARD_CATEGORIES.map((value) => <button key={value} type="button" aria-pressed={category === value} aria-controls={resultsId} onClick={() => setCategory(value)}>{copy.categories[value]}</button>)}
    </div>
    <div className={styles.guide}>
      <p>{copy.descriptions[category]}</p>
      <details>
        <summary>{copy.guide}</summary>
        <dl>{LEADERBOARD_CATEGORIES.filter(value => value !== "all").map(value => <div key={value}><dt>{copy.categories[value]}</dt><dd>{copy.descriptions[value]}</dd></div>)}</dl>
        <p>{copy.equalScores}</p>
      </details>
    </div>
    <div id={resultsId} aria-busy={state.status === "loading"}>
      {state.status !== "ready" ? <ResourceMessage locale={locale} error={state.status === "error"} retry={retry} /> : <>
        {state.data.me && <div className={styles.myRank}>
          <div className={styles.myPosition}><span>{locale === "ko" ? "내 순위" : translate(locale, localizedMessages.m0c416452a30e, "My rank")}</span><strong>{state.data.me.rank.toLocaleString(locale)}{locale === "ko" ? "위" : ""}</strong></div>
          <Avatar avatar={fallbackAvatar} imageUrl={state.data.me.avatarUrl} size={40} label="" />
          <b>{state.data.me.nickname}</b>
          <strong className={styles.myScore}>{state.data.me.points.toLocaleString(locale)}<span>{locale === "ko" ? "점" : translate(locale, localizedMessages.m5a9d59babd7a, " pts")}</span></strong>
        </div>}
        {state.data.rows.length ? <table>
          <caption className={styles.srOnly}>{copy.categories[category]} · {locale === "ko" ? "팬점수 상위 100명" : translate(locale, localizedMessages.me3c0cbcd4819, "Top 100 fans")}</caption>
          <thead><tr>
            <th scope="col">{locale === "ko" ? "순위" : translate(locale, localizedMessages.m571a4229f7f8, "Rank")}</th>
            <th scope="col">{locale === "ko" ? "팬" : translate(locale, localizedMessages.m9d49652f660e, "Fan")}</th>
            <th scope="col">{locale === "ko" ? "팬점수" : translate(locale, localizedMessages.m6323df1ec8f1, "Fan Score")}</th>
          </tr></thead>
          <tbody>{state.data.rows.map(row => <tr key={row.rank} data-own={row.rank === state.data.me?.rank || undefined}>
            <td><span className={styles.rank} data-medal={row.rank <= 3 ? row.rank : undefined}>{row.rank <= 3 && <span className={styles.srOnly}>{copy.medals[row.rank - 1]} </span>}{row.rank}</span></td>
            <td><div className={styles.rankedFan}><Avatar avatar={fallbackAvatar} imageUrl={row.avatarUrl} size={40} label="" /><strong>{row.nickname}</strong></div></td>
            <td>{row.points.toLocaleString(locale)}</td>
          </tr>)}</tbody>
        </table> : <div className={styles.empty}><p>{copy.empty}</p><FanAction href={fanPageHref(slug, locale, "home")} variant="neutral">{copy.explore}</FanAction></div>}
        <p className={styles.tieRule}>{copy.ties}</p>
        <p className={styles.asOf}>{locale === "ko" ? "집계 기준" : translate(locale, localizedMessages.m9f47b9144046, "As of")} <time dateTime={state.data.asOf}>{new Intl.DateTimeFormat(locale, { calendar: "gregory", dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(state.data.asOf))}</time></p>
      </>}
    </div>
  </section>;
}
