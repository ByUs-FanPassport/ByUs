import type { ReactNode } from "react";

import {
  stampTypeLabel,
  type PassportLocale,
} from "@/features/passport/domain/passport-read-model";
import {
  StampArtwork,
  type PassportStampType,
} from "@/features/passport/ui/passport-stamp-artwork";

import { FanAction } from "./fan-action";
import styles from "./fan-activity-completion-summary.module.css";

export function FanActivityCompletionSummary({
  locale,
  stampType,
  title,
  description,
  scoreDelta,
  updatedScore,
  updatedLevel,
  leveledUp = false,
  passportHref,
  primaryAction,
  note,
  headingLevel = 2,
  headingId,
}: {
  locale: PassportLocale;
  stampType: PassportStampType;
  title: string;
  description: string;
  scoreDelta: number;
  updatedScore?: number;
  updatedLevel?: string;
  leveledUp?: boolean;
  passportHref?: string;
  primaryAction?: ReactNode;
  note?: string;
  headingLevel?: 1 | 2 | 3;
  headingId?: string;
}) {
  const stampName = stampTypeLabel(locale, stampType);
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  return (
    <div className={styles.summary}>
      <div className={styles.artwork}>
        <StampArtwork type={stampType} locale={locale} label={stampName} />
      </div>
      <div className={styles.content}>
        <p className={styles.eyebrow}>{stampName} Stamp</p>
        <Heading id={headingId}>{title}</Heading>
        <p className={styles.description}>{description}</p>
        <dl className={styles.metrics} aria-label={locale === "ko" ? "활동 보상" : "Activity rewards"}>
          <div><dt>Fan Score</dt><dd>+{scoreDelta}</dd></div>
          {typeof updatedScore === "number" ? (
            <div><dt>{locale === "ko" ? "총점" : "Total"}</dt><dd>{updatedScore}</dd></div>
          ) : null}
          {updatedLevel ? (
            <div><dt>{locale === "ko" ? "레벨" : "Level"}</dt><dd>{leveledUp && locale === "ko" ? `상승 · ${updatedLevel}` : leveledUp ? `Up · ${updatedLevel}` : updatedLevel}</dd></div>
          ) : null}
        </dl>
        {note ? <p className={styles.note}>{note}</p> : null}
        <div className={styles.actions}>
          {passportHref ? (
            <FanAction href={passportHref} variant="neutral">
              {locale === "ko" ? "Passport에서 확인하기" : "View in Passport"}
            </FanAction>
          ) : null}
          {primaryAction}
        </div>
      </div>
    </div>
  );
}
