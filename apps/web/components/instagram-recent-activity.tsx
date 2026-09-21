"use client";

import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/components__instagram-recent-activity";
import { translate } from "@/i18n/messages";
import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { Play } from "./icons";
import { instagramMediaSchema, type InstagramMedia } from "../server/instagram/model";
import styles from "./instagram-recent-activity.module.css";

export function InstagramRecentActivity({ slug, locale, fallback = null }: { slug: string; locale: AppLocale; fallback?: ReactNode }) {
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(`/api/celebrities/${encodeURIComponent(slug)}/instagram`, { signal: current.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const body: unknown = await response.json();
        const parsed = instagramMediaSchema.array().max(3).safeParse(body && typeof body === "object" && "items" in body ? body.items : null);
        if (!parsed.success) throw new Error();
        if (active) setMedia(parsed.data);
      } catch {
        if (active && !current.signal.aborted) setMedia([]);
      }
    };
    setMedia([]);
    setFailedImages(new Set());
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [slug]);
  const cards = media.filter((item) => !failedImages.has(item.imageUrl));
  if (!cards.length) return fallback;
  return <section className={styles.section} aria-labelledby="instagram-activity-title">
    <h2 id="instagram-activity-title">{locale === "ko" ? "최근 활동" : translate(locale, localizedMessages.m827eba9cc92d, "Recent activity")}</h2>
    <div className={styles.grid}>
      {cards.map((item) => <a key={item.id} className={styles.card} href={item.permalink} target="_blank" rel="noopener noreferrer"
        aria-label={`${item.caption || `@${item.sourceAccount.username}`} · ${locale === "ko" ? "Instagram에서 보기, 새 창" : translate(locale, localizedMessages.mcacf27040a99, "View on Instagram, new window")}`}>
        <div className={styles.media}>
          <Image src={item.imageUrl} alt="" width={900} height={1600} unoptimized referrerPolicy="no-referrer"
            onError={() => setFailedImages((previous) => new Set(previous).add(item.imageUrl))} />
          {item.mediaType === "VIDEO" && <span className={styles.play} aria-hidden="true"><Play /></span>}
        </div>
      </a>)}
    </div>
  </section>;
}
