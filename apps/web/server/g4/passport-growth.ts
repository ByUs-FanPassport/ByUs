import {
  type PassportLevel,
} from "../../features/passport/domain/passport-read-model";
import type {
  PassportDetail,
  PassportDetailRecord,
  PassportProgress,
} from "../../features/passport/domain/passport-detail";
import { FAN_LEVEL_THRESHOLDS } from "../score/score-unlock-event";
import {
  REWARD_POLICY_V2,
  tierForScore,
  tierRank,
} from "../../features/rewards/domain/reward-policy";

export function derivePassportProgress(
  score: number,
  projectedLevel: PassportLevel,
): PassportProgress {
  if (!Number.isInteger(score) || score < 0) {
    throw new Error("invalid Passport score");
  }
  const currentLevel = tierForScore(REWARD_POLICY_V2, score);
  // A pre-cutover Tier is an attained entitlement. Score v2 can advance it,
  // but can never make it go backwards.
  const effectiveLevel =
    tierRank(projectedLevel) > tierRank(currentLevel)
      ? projectedLevel
      : currentLevel;
  const next = FAN_LEVEL_THRESHOLDS.find(
    ({ name }) => tierRank(name) > tierRank(effectiveLevel),
  ) ?? null;
  if (!next) {
    return {
      currentScore: score,
      currentLevel: effectiveLevel,
      nextLevel: null,
      nextThreshold: null,
      remainingPoints: 0,
      percent: 100,
      maxed: true,
    };
  }
  return {
    currentScore: score,
    currentLevel: effectiveLevel,
    nextLevel: next.name,
    nextThreshold: next.score,
    remainingPoints: next.score - score,
    percent: Math.min(100, Math.round((score / next.score) * 100)),
    maxed: false,
  };
}

export function attachPassportGrowth(
  passport: PassportDetailRecord,
): PassportDetail {
  return {
    ...passport,
    progress: derivePassportProgress(passport.score.points, passport.score.level),
  };
}
