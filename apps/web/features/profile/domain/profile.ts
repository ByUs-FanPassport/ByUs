import { z } from "zod";
import { getNicknameFormat } from "./nickname-format";

export const NICKNAME_CATALOG_VERSION = "fan-nickname-v1" as const;

export const fanProfileSchema = z.object({
  completed: z.boolean(),
  nickname: z.string().min(2).max(16).nullable(),
}).strict().superRefine((profile, context) => {
  if (profile.completed !== (profile.nickname !== null)) {
    context.addIssue({ code: "custom", message: "profile completion and nickname must agree" });
  }
});

export type FanProfile = z.infer<typeof fanProfileSchema>;

const prohibitedNicknameEntries = [
  "admin", "administrator", "system", "operator", "official",
  "관리자", "운영자", "공식", "byus", "바이어스", "kara", "카라", "katseye", "캣츠아이",
  "fuck", "shit", "bitch", "시발", "씨발", "병신",
] as const;

export type NicknameValidationFailure = "invalid" | "prohibited";

export class NicknameValidationError extends Error {
  constructor(readonly reason: NicknameValidationFailure) {
    super(reason);
    this.name = "NicknameValidationError";
  }
}

/** Mirrors the database boundary and adds the versioned prohibited-name check. */
export function normalizeNickname(input: string): { nickname: string; normalized: string } {
  const format = getNicknameFormat(input);
  if (!format.valid) {
    throw new NicknameValidationError("invalid");
  }

  const prohibitedCandidate = format.normalized.replace(/[ _-]+/g, "");
  if (
    prohibitedNicknameEntries.some(
      (entry) =>
        format.normalized.includes(entry)
        || prohibitedCandidate.includes(entry),
    )
  ) {
    throw new NicknameValidationError("prohibited");
  }
  return { nickname: format.nickname, normalized: format.normalized };
}
