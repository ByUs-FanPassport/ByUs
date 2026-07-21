import { z } from "zod";

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

const allowedNickname = /^[A-Za-z0-9가-힣]+$/u;
const prohibitedNicknameEntries = [
  "admin", "administrator", "system", "operator", "official",
  "관리자", "운영자", "공식", "byus", "바이어스", "kara", "카라",
  "fuck", "shit", "bitch", "시발", "씨발", "병신",
] as const;

export type NicknameValidationFailure = "invalid" | "prohibited";

export class NicknameValidationError extends Error {
  constructor(readonly reason: NicknameValidationFailure) {
    super(reason);
    this.name = "NicknameValidationError";
  }
}

/** Mirrors the database boundary: trim ordinary form spaces, then apply NFKC. */
export function normalizeNickname(input: string): { nickname: string; normalized: string } {
  const nickname = input.replace(/^ +| +$/g, "").normalize("NFKC");
  const length = Array.from(nickname).length;
  if (length < 2 || length > 16 || !allowedNickname.test(nickname)) {
    throw new NicknameValidationError("invalid");
  }

  const normalized = nickname.toLowerCase();
  if (prohibitedNicknameEntries.some((entry) => normalized.includes(entry))) {
    throw new NicknameValidationError("prohibited");
  }
  return { nickname, normalized };
}

