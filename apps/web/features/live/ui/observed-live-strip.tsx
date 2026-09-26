"use client";

import { toContentLocale } from "@/i18n/locales";
import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__live__ui__observed-live-strip";
import { translate } from "@/i18n/messages";
import { ArrowUpRight, ChevronRight, Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { FanHeading } from "@/components/fan-ui/fan-heading";
import { LiveStatusIndicator } from "@/components/live-status-indicator";
import {
  isObservedLiveCardFresh,
  mergeObservedLiveFeed,
  observedLiveKey,
  observedLiveMaxAge,
  OBSERVED_LIVE_POLL_MS,
  type ObservedLiveCard,
} from "../domain/observed-live";
import styles from "./observed-live-strip.module.css";

const fresh = isObservedLiveCardFresh;
const TikTokLivePlayer = dynamic(() => import("./tiktok-live-player").then((module) => module.TikTokLivePlayer), { ssr: false });

function LiveCover({ item }: { item: ObservedLiveCard }) {
  const [src, setSrc] = useState(item.thumbnailUrl);
  const [failed, setFailed] = useState(false);
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer"
    style={failed ? { visibility: "hidden" } : undefined}
    onError={() => {
      if (item.fallbackThumbnailUrl && src !== item.fallbackThumbnailUrl) setSrc(item.fallbackThumbnailUrl);
      else setFailed(true);
    }} />;
}

export function ObservedLiveStrip({ locale }: { locale: AppLocale }) {
  const headingId = useId();
  const [items, setItems] = useState<ObservedLiveCard[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<ObservedLiveCard | null>(null);

  useEffect(() => {
    let stopped = false;
    let pending = false;
    let controller: AbortController | null = null;
    setItems([]);
    const refresh = async () => {
      setNow(Date.now());
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12_000);
      try {
        const response = await fetch(`/api/public/live-now?locale=${toContentLocale(locale)}&v=4`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("LIVE unavailable");
        const feed: unknown = await response.json();
        if (!stopped) {
          const checkedAt = Date.now();
          setNow(checkedAt);
          setItems((previous) => mergeObservedLiveFeed(previous, feed, checkedAt));
        }
      } catch {
        if (!stopped) {
          const checkedAt = Date.now();
          setNow(checkedAt);
          setItems((previous) => previous.filter((item) => fresh(item, checkedAt)));
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), OBSERVED_LIVE_POLL_MS);
    const onVisibility = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [locale]);

  // Expiry runs independently of refresh: even a hanging request or hidden tab
  // must not leave an old observation labelled LIVE indefinitely.
  useEffect(() => {
    const expiries = items.filter((item) => fresh(item, now)).map((item) =>
      Math.min(Date.parse(item.expiresAt), Date.parse(item.observedAt) + observedLiveMaxAge(item.platform)));
    if (!expiries.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [items, now]);

  const visible = items.filter((item) => fresh(item, now));
  return <>
    {visible.length ? <LiveCards key={visible.map(observedLiveKey).join("|")} items={visible} locale={locale} headingId={headingId} onWatch={setSelected} /> : null}
    {selected ? <TikTokLivePlayer item={visible.find((item) => observedLiveKey(item) === observedLiveKey(selected)) ?? selected} locale={locale} onClose={() => setSelected(null)} /> : null}
  </>;
}

function LiveCards({ items, locale, headingId, onWatch }: { items: ObservedLiveCard[]; locale: AppLocale; headingId: string; onWatch: (item: ObservedLiveCard) => void }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const title = locale === "ko" ? "지금 LIVE 중" : translate(locale, localizedMessages.m5faa6bee45bd, "Live now");
  const syncPage = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    const start = cards[0].offsetLeft;
    const nearest = cards.reduce((best, card, index) =>
      Math.abs(card.offsetLeft - start - grid.scrollLeft) < Math.abs(cards[best].offsetLeft - start - grid.scrollLeft) ? index : best, 0);
    setPage(nearest);
  };
  const next = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const first = grid.children[0] as HTMLElement;
    const target = grid.children[(page + 1) % items.length] as HTMLElement;
    grid.scrollTo({
      left: target.offsetLeft - first.offsetLeft,
      behavior: "instant",
    });
  };
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.header}>
        <FanHeading id={headingId}>{title}</FanHeading>
        <span className={styles.count}>{items.length}</span>
        {items.length > 1 ? <div className={styles.pagination}>
          <span aria-live="polite" aria-atomic="true">{page + 1} / {items.length}</span>
          <button type="button" onClick={next} aria-controls={`${headingId}-cards`}
            aria-label={locale === "ko" ? "다음 LIVE" : translate(locale, localizedMessages.md4cec06a6176, "Next LIVE")}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div> : null}
      </header>
      <div ref={gridRef} id={`${headingId}-cards`} className={styles.grid} onScroll={syncPage}>
        {items.map((item) => {
          const internal = !item.platform || item.platform === "tiktok";
          const body = <>
            <div className={styles.cover}>
              {/* Upstream covers expire and are intentionally not persisted in the image optimizer. */}
              <LiveCover key={item.thumbnailUrl} item={item} />
              <LiveStatusIndicator className={styles.badge} status="live" locale={locale} density="compact" />
            </div>
            <div className={styles.body}>
              <span className={styles.creator}>{item.creatorName}</span>
              <h3>{item.title}</h3>
              <span className={styles.watch}>{watchLabel(item, locale)}{internal ? <Play aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}</span>
            </div>
          </>;
          return internal ? <button type="button" className={styles.card} key={observedLiveKey(item)} onClick={() => onWatch(item)}
            aria-haspopup="dialog" aria-label={`${item.creatorName} · ${item.title} · ${watchLabel(item, locale)}`}>{body}</button>
            : <a className={styles.card} key={observedLiveKey(item)} href={item.watchUrl} target="_blank" rel="noopener noreferrer"
              aria-label={`${item.creatorName} · ${item.title} · ${watchLabel(item, locale)}, ${locale === "ko" ? "새 창" : translate(locale, localizedMessages.mc3e79a000f51, "new tab")}`}>{body}</a>;
        })}
      </div>
    </section>
  );
}

function watchLabel(item: ObservedLiveCard, locale: AppLocale): string {
  const provider = item.platform === "youtube" ? "YouTube" : item.platform === "instagram" ? "Instagram" : item.platform === "chzzk" ? "CHZZK" : "ByUs";
  return locale === "ko" ? `${provider}에서 시청` : translate(locale, localizedMessages.m7ce4b315a780, "Watch on {0}", [provider]);
}
