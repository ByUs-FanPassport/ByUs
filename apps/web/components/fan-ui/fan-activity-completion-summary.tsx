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
        <span className={styles.points} aria-label={locale === "ko" ? `팬 점수 ${scoreDelta}점 획득` : `Earned ${scoreDelta} Fan Score`}>
          +{scoreDelta}
        </span>
      </div>
      <div className={styles.content}>
        <p className={styles.eyebrow}>{stampName} Stamp</p>
        <Heading id={headingId}>{title}</Heading>
        <p className={styles.description}>{description}</p>
        <div className={styles.metrics} aria-label={locale === "ko" ? "활동 보상" : "Activity rewards"}>
          <span>{locale === "ko" ? `Fan Score +${scoreDelta}` : `Fan Score +${scoreDelta}`}</span>
          {typeof updatedScore === "number" ? (
            <span>{locale === "ko" ? `총점 ${updatedScore}` : `Total ${updatedScore}`}</span>
          ) : null}
          {updatedLevel ? (
            <span>{leveledUp && locale === "ko" ? `레벨 상승 · ${updatedLevel}` : leveledUp ? `Level up · ${updatedLevel}` : updatedLevel}</span>
          ) : null}
        </div>
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
