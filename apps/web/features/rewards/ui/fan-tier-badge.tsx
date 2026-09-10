import Image from "next/image";
import { fanStageLabel, fanTierEntryKey, type FanStage, type FanStageKey } from "../domain/fan-stage";

type Props = {
  tier: FanStage["tier"];
  stageKey?: FanStageKey | null;
  locale: "ko" | "en";
  size: number;
  adjacentLabel?: boolean;
  className?: string;
};

export function FanTierBadge({ tier, stageKey, locale, size, adjacentLabel = true, className }: Props) {
  const key = stageKey ?? fanTierEntryKey(tier);
  const sourceSize = size > 64 ? 256 : 128;
  const label = fanStageLabel(locale, { tier, subdivision: Number(key.split("-").at(-1)) });
  return <Image
    className={className}
    src={`/images/passport/tiers/opal-heart/${sourceSize}/${key}.png`}
    width={size}
    height={size}
    alt={adjacentLabel ? "" : `${label} fan tier`}
    aria-hidden={adjacentLabel ? "true" : undefined}
  />;
}
