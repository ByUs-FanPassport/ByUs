import { z } from "zod";
import type { RaffleList } from "../../benefit/domain/raffle";
import type { CertificationHistoryItem, CertificationListItem } from "../../certification/domain/certification";
import { nextPassportBenefitSchema } from "../../passport/domain/passport-detail";
import { FAN_TIERS, tierRank } from "../../rewards/domain/reward-policy";
import type { MySummary } from "./my-summary";

export type MyCreator = MySummary["creators"][number];
export type PassportCreator = MyCreator & { passport: NonNullable<MyCreator["passport"]> };

/** A creator's attained tier remains authoritative; never infer it from score. */
export function rankedPassportCreators(creators: readonly MyCreator[]): PassportCreator[] {
  return creators.filter((creator): creator is PassportCreator => creator.passport !== null)
    .toSorted((a, b) => tierRank(b.passport.tier) - tierRank(a.passport.tier)
      || b.passport.score - a.passport.score
      || (a.celebrity.slug < b.celebrity.slug ? -1 : a.celebrity.slug > b.celebrity.slug ? 1 : 0));
}

// Read only the MY projection from the existing, owner-authorized detail response.
export const myBenefitPassportSchema = z.object({
  passport: z.object({
    id: z.uuid(),
    celebrity: z.object({ slug: z.string(), name: z.string() }),
    score: z.object({ points: z.number().int().nonnegative(), level: z.enum(FAN_TIERS) }),
    nextBenefit: nextPassportBenefitSchema.nullable(),
  }),
});

export function benefitScorePercent(score: number, minimumScore: number): number | null {
  return minimumScore > 0 ? Math.min(100, Math.max(0, Math.round(score / minimumScore * 100))) : null;
}

export function fanTierProgress(passport: PassportCreator["passport"]) {
  const tierIndex = FAN_TIERS.indexOf(passport.tier);
  const nextTier = FAN_TIERS[tierIndex + 1] ?? null;
  if (!nextTier) return { nextTier: null, nextThreshold: null, remaining: 0, percent: 100, maxed: true } as const;
  const nextThreshold = passport.score + passport.remainingToNextTier;
  return {
    nextTier,
    nextThreshold,
    remaining: passport.remainingToNextTier,
    percent: nextThreshold > 0 ? Math.min(100, Math.max(0, Math.round(passport.score / nextThreshold * 100))) : 0,
    maxed: false,
  } as const;
}

export function selectOpenRaffle(raffles: RaffleList["raffles"], now = new Date()) {
  const timestamp = now.getTime();
  return raffles.filter((raffle) => {
    if (raffle.status !== "open" || !raffle.benefitId || !raffle.entryOpensAt || !raffle.entryClosesAt) return false;
    const opensAt = Date.parse(raffle.entryOpensAt);
    const closesAt = Date.parse(raffle.entryClosesAt);
    return Number.isFinite(opensAt) && Number.isFinite(closesAt) && opensAt <= timestamp && timestamp < closesAt;
  }).toSorted((a, b) => Date.parse(a.entryClosesAt!) - Date.parse(b.entryClosesAt!) || a.id.localeCompare(b.id))[0] ?? null;
}

export function nextRaffleBoundary(raffles: RaffleList["raffles"], now: number) {
  const boundaries = raffles.flatMap((raffle) => [
    raffle.entryOpensAt ? { at: Date.parse(raffle.entryOpensAt), opens: true } : null,
    raffle.entryClosesAt ? { at: Date.parse(raffle.entryClosesAt), opens: false } : null,
  ]).filter((value): value is { at: number; opens: boolean } => value !== null && Number.isFinite(value.at) && value.at > now)
    .toSorted((a, b) => a.at - b.at || Number(b.opens) - Number(a.opens));
  return boundaries[0] ?? null;
}

export function latestCertificationHistory(history: readonly CertificationHistoryItem[]) {
  const latest = new Map<string, CertificationHistoryItem>();
  for (const item of history) {
    const key = `${item.kind}:${item.missionId}`;
    const current = latest.get(key);
    const submittedAt = Date.parse(item.submittedAt);
    const currentSubmittedAt = current ? Date.parse(current.submittedAt) : Number.NEGATIVE_INFINITY;
    if (!current || submittedAt > currentSubmittedAt
      || (submittedAt === currentSubmittedAt && (item.attemptNumber > current.attemptNumber
        || (item.attemptNumber === current.attemptNumber && item.id.localeCompare(current.id) > 0)))) latest.set(key, item);
  }
  return latest;
}

export function recommendCertification(
  available: readonly CertificationListItem[],
  history: readonly CertificationHistoryItem[],
  hasPassport: boolean,
) {
  const latest = latestCertificationHistory(history);
  return available.find((mission) => {
    if (mission.status !== "available" || (hasPassport && mission.kind === "quiz")) return false;
    const previous = latest.get(`${mission.kind}:${mission.id}`);
    return !previous || previous.status === "rejected";
  }) ?? null;
}

export function localizedPath(path: string, locale: "ko" | "en") {
  if (!/^\/(?!\/)/.test(path) || path.includes("\\")) return null;
  const url = new URL(path, "https://byus.local");
  if (url.origin !== "https://byus.local") return null;
  url.searchParams.set("locale", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}
