import {
  type PassportLevel,
} from "../../features/passport/domain/passport-read-model";
import type {
  PassportDetail,
  PassportDetailRecord,
  PassportProgress,
} from "../../features/passport/domain/passport-detail";
import { FAN_LEVEL_THRESHOLDS } from "../score/score-unlock-event";

export function derivePassportProgress(
  score: number,
  projectedLevel: PassportLevel,
): PassportProgress {
  if (!Number.isInteger(score) || score < 0) {
    throw new Error("invalid Passport score");
  }
  const currentLevel = [...FAN_LEVEL_THRESHOLDS]
    .reverse()
    .find(({ score: threshold }) => score >= threshold)?.name ?? "Bronze";
  if (currentLevel !== projectedLevel) {
    throw new Error("Passport score and level are inconsistent");
  }
  const next = FAN_LEVEL_THRESHOLDS.find(({ score: threshold }) => score < threshold) ?? null;
  if (!next) {
    return {
      currentScore: score,
      currentLevel,
      nextLevel: null,
      nextThreshold: null,
      remainingPoints: 0,
      percent: 100,
      maxed: true,
    };
  }
  return {
    currentScore: score,
    currentLevel,
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
