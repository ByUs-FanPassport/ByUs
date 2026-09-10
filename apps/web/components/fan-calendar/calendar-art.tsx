"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CreatorImage } from "@/components/fan-ui/creator-image";
import { creatorCalendarPhotos, hasCreatorCalendarPhotos } from "@/components/fan-ui/creator-image-config";
import styles from "./calendar-art.module.css";

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Decorative only: the caller owns selection, dates and accessible calendar labels. */
export function CalendarArt({ month, celebrity, compact = false }: {
  compact?: boolean;
  month: string;
  celebrity?: { slug: string; name: string; image: string };
}) {
  const [shown, setShown] = useState(celebrity);
  const changing = shown?.slug !== celebrity?.slug;
  useEffect(() => {
    if (!changing) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShown(celebrity), reduced ? 0 : 130);
    return () => window.clearTimeout(timer);
  }, [celebrity, changing]);
  const monthName = months[Number(month.slice(5, 7)) - 1];
  const availablePhotos = shown ? creatorCalendarPhotos(shown.slug, shown.image) : [];
  const photos = compact ? availablePhotos.slice(0, 2) : availablePhotos;
  return <div className={styles.art} aria-hidden="true" data-calendar-art data-compact={compact ? "true" : undefined}>
    <div className={styles.month}>
      <span className={styles.number}>{month.slice(5, 7)}</span>
      {monthName ? <Image className={styles.letter} src={`/images/calendar/lettering/${monthName}.svg`} alt="" width={400} height={130} /> : null}
      <span className={styles.year}>{month.slice(0, 4)}</span>
    </div>
    <div className={styles.slot}>
      <div className={styles.composition} key={shown?.slug ?? "byus"} data-leaving={changing ? "true" : undefined} data-calendar-art-mode={shown?.slug ?? "byus"}>
        {shown ? <div className={styles.collage} data-single={photos.length === 1 ? "true" : undefined} data-count={photos.length}>
          {photos.map((src) => <div className={styles.card} key={src}>
            <span className={styles.frame} />
            <Image className={styles.tape} src="/images/calendar/tape-pink.svg" alt="" width={90} height={28} />
            <div className={styles.photo} data-group={shown.slug === "xin" || !hasCreatorCalendarPhotos(shown.slug) ? "true" : undefined}>
              <CreatorImage slug={shown.slug} src={src} alt="" fill sizes="170px" presentation="calendar" />
            </div>
            <span className={styles.name}>{shown.name}</span>
            <Image className={styles.cardStar} src="/images/calendar/star-spark.svg" alt="" width={16} height={16} />
          </div>)}
        </div> : <Image className={styles.brand} src="/images/calendar/lettering/byus.svg" alt="" width={360} height={210} />}
        <Image className={styles.star} src="/images/calendar/star-handwritten.svg" alt="" width={40} height={40} />
      </div>
    </div>
  </div>;
}
