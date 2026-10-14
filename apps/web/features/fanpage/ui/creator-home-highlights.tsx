import { ArrowRight } from "lucide-react";
import { FanAction } from "@/components/fan-ui/fan-action";
import type { AppLocale } from "@/i18n/locales";
import { discoveryCopy } from "@/i18n/catalogs/features__fan_posts__discovery";
import { feedCopy } from "@/i18n/catalogs/features__fan_posts__feed";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import { boardHref } from "../domain/board-navigation";
import { CreatorMediaPanel } from "@/features/media/ui/creator-media-panel";
import styles from "./creator-home-highlights.module.css";

export function CreatorHomeHighlights({ celebrity, locale, channelId }: { celebrity: PublishedCelebrity; locale: AppLocale; channelId: string | null }) {
  const discovery = discoveryCopy(locale);
  return <div className={styles.highlights}>
    <CreatorMediaPanel key={`${celebrity.slug}:${locale}`} slug={celebrity.slug} locale={locale} channelId={channelId} socialLinks={celebrity.socialLinks} preview />
    <div className={styles.community}>
      <p>{discovery.communityIntro}</p>
      <FanAction href={boardHref(celebrity.slug, locale, { source: "fans" })} variant="neutral" trailingIcon={<ArrowRight aria-hidden="true" />}>{feedCopy(locale).fanBoard}</FanAction>
    </div>
  </div>;
}
