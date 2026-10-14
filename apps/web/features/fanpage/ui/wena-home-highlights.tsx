import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CreatorImage } from "@/components/fan-ui/creator-image";
import { FanSectionHeader } from "@/components/fan-ui/fan-heading";
import { FanAction } from "@/components/fan-ui/fan-action";
import type { AppLocale } from "@/i18n/locales";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { participationCopy } from "@/i18n/catalogs/features__schedules__ui__participation";
import { feedCopy } from "@/i18n/catalogs/features__fan_posts__feed";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { boardHref } from "../domain/board-navigation";
import { CreatorOfficialVideos } from "./creator-official-videos";
import styles from "./wena-home-highlights.module.css";

export function WenaHomeHighlights({ celebrity, locale }: { celebrity: PublishedCelebrity; locale: AppLocale }) {
  const copy = participationCopy(locale), discovery = discoveryCopy(locale);
  const photosHref = boardHref("wena", locale, { section: "media", mediaFilter: "photos" });
  return <div className={styles.highlights}>
    <div className={styles.media}>
      <CreatorOfficialVideos slug="wena" locale={locale} />
      <section className={styles.photos} aria-label={copy.photos}>
        <FanSectionHeader title={copy.photos} action={{ label: copy.more, href: photosHref }} />
        <Link href={photosHref} aria-label={`${copy.photos} · We;Na`} className={styles.photoLink}>
          <CreatorImage slug="wena" src={celebrity.image.url} photos={celebrity.image.photos} presentation="portrait" locale={locale} position={celebrity.image.position} alt="" width={1200} height={1200} sizes="(min-width:1440px) 424px, (min-width:768px) 33vw, calc(100vw - 32px)" />
        </Link>
      </section>
    </div>
    <div className={styles.community}>
      <p>{discovery.communityIntro}</p>
      <FanAction href={boardHref("wena", locale, { source: "fans" })} variant="neutral" trailingIcon={<ArrowRight aria-hidden="true" />}>{feedCopy(locale).fanBoard}</FanAction>
    </div>
  </div>;
}
