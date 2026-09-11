"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { ContentLocale } from "@/server/content/content-domain";
import { elinaLiveSlug } from "../domain/elina-event";
import { liveEventResponseSchema } from "../domain/live-event";
import styles from "./elina-mission-entry.module.css";

const ELINA_SLUG = "elina";
const ARTWORKS = [
  "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/public-image-assets/a38bb88324437e505d910db35f94331cf67725fdb849871c60e8e0d1ce7e6b14.webp",
  "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/public-image-assets/9d1c78f0f777e0d34f304d4aae973115c11832ef00804148072440e44e4a9925.webp",
  "https://gmrykvmtmuaeswpajteq.supabase.co/storage/v1/object/public/cms-assets/public-image-assets/5fca43c55e3aa002782e63aa3cd0135c484c55c4f49d2a88c01ef5c91ee0d382.webp",
] as const;

const copy = {
  ko: {
    eyebrow: "지금 참여할 미션",
    title: "엘리나와 뱅크시 한 작품",
    invitation: "마음에 드는 작품을 고르고, 그림 속 디테일도 찾아봐요.",
    count: "투표 1개 · 퀴즈 1개",
    action: "미션 시작하기",
    hint: "작품을 고르고 스탬프를 남겨요.",
  },
  en: {
    eyebrow: "MISSIONS OPEN NOW",
    title: "Elina and Banksy, one artwork",
    invitation: "Pick your favorite artwork, then look for a detail in the picture.",
    count: "1 vote · 1 quiz",
    action: "Start missions",
    hint: "Complete a mission to record a Stamp.",
  },
} as const;

export function ElinaMissionEntry({ celebritySlug, locale }: { celebritySlug: string; locale: ContentLocale }) {
  const titleId = useId();
  const visibilityKey = `${celebritySlug}:${locale}`;
  const [visibleFor, setVisibleFor] = useState<string | null>(null);

  useEffect(() => {
    setVisibleFor(null);
    if (celebritySlug !== ELINA_SLUG) return;

    const controller = new AbortController();
    void (async () => {
      const response = await fetch(`/api/live-events/${elinaLiveSlug}?locale=${locale}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const body = liveEventResponseSchema.parse(await response.json());
      const isElinaMissionLive = body.live.slug === elinaLiveSlug && body.live.celebrity.slug === ELINA_SLUG;
      if (!controller.signal.aborted && isElinaMissionLive && body.live.missionsAvailable === true) setVisibleFor(visibilityKey);
    })().catch(() => undefined);

    return () => controller.abort();
  }, [celebritySlug, locale, visibilityKey]);

  if (celebritySlug !== ELINA_SLUG || visibleFor !== visibilityKey) return null;
  const text = copy[locale];

  return <section className={styles.card} aria-labelledby={titleId}>
    <div className={styles.copy}>
      <p className={styles.eyebrow}>{text.eyebrow}</p>
      <h2 id={titleId}>{text.title}</h2>
      <p className={styles.invitation}>{text.invitation}</p>
      <p className={styles.count}>{text.count}</p>
      <Link className={styles.action} href={`/live/${elinaLiveSlug}/missions?locale=${locale}`}>{text.action}</Link>
      <p className={styles.hint}>{text.hint}</p>
    </div>
    <div className={styles.artworks} aria-hidden="true">
      {ARTWORKS.map((src) => <div className={styles.artwork} key={src}>
        <Image src={src} alt="" fill sizes="(max-width: 767px) 28vw, 160px" />
      </div>)}
    </div>
  </section>;
}
