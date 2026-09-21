"use client";
import { toContentLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__fanpage__ui__fan-activity-panel";
import { translate } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/locales";
import { fanpageSummarySchema } from "../domain/community";
import { useFanpageResource } from "./use-fanpage-resource";
import styles from "./fanpage.module.css";
const parse = (value: unknown) => fanpageSummarySchema.parse(value);
export function FanActivityPanel({ slug, locale }: { slug: string; locale: AppLocale }) {
  const resource = useFanpageResource(`/api/celebrities/${slug}/fanpage?locale=${toContentLocale(locale)}`, parse, true);
  const ko = locale === "ko";
  return <section className={styles.activity}><h2>{locale === "ko" ? "함께하는 팬들" : translate(locale, localizedMessages.m4d2ea02dbe18, "Fan community")}</h2>{resource.state.status === "ready" ? resource.state.data.activity.length ? <ul>{resource.state.data.activity.map((event, index) => <li key={`${event.occurredAt}:${index}`}><img src={event.avatarUrl} width={32} height={32} alt="" /><p><strong>{event.nickname}</strong>{ko ? (event.kind === "joined" ? "님이 팬 여정을 시작했어요." : event.kind === "level_up" ? "님이 새로운 팬 등급에 올랐어요." : "님이 첫 인증을 마쳤어요.") : (event.kind === "joined" ? translate(locale, localizedMessages.m68f6f4381992, " started their fan journey.") : event.kind === "level_up" ? translate(locale, localizedMessages.mc6e03d1a5ac1, " reached a new fan tier.") : translate(locale, localizedMessages.m77780ba847bd, " completed their first verification."))}</p></li>)}</ul> : <p className={styles.muted}>{locale === "ko" ? "새로운 팬 활동을 기다리고 있어요." : translate(locale, localizedMessages.ma355bfbf32b5, "Waiting for new fan activity.")}</p> : <p className={styles.muted}>{ko ? (resource.state.status === "error" ? "팬 활동을 불러오지 못했어요." : "팬 활동을 확인하고 있어요.") : translate(locale, localizedMessages.me024fd673119, "Checking fan activity.")}</p>}
    {resource.refreshFailed && <p className={styles.muted}>{locale === "ko" ? "팬 활동을 갱신하지 못했어요." : translate(locale, localizedMessages.m889740d3a689, "Couldn't refresh fan activity.")} <button onClick={resource.retry}>{locale === "ko" ? "다시 시도" : translate(locale, localizedMessages.mba4494c6ec55, "Try again")}</button></p>}
  </section>;
}
