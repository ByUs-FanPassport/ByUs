import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const kakaoConnectionCallbackSchema = z.object({
  code: z.string().trim().min(1), state: z.string().trim().min(32),
  error: z.string().trim().min(1).optional(),
});

export const safeKakaoReturnPathSchema = z.string().regex(/^\/(?:my|settings)(?:[/?#].*)?$/);

export interface KakaoConnectionPort {
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ kakaoSubject: string }>;
}

export function createKakaoPkce(): { state: string; stateHash: string; codeVerifier: string; codeChallenge: string } {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  return {
    state, codeVerifier,
    stateHash: createHash("sha256").update(state).digest("hex"),
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function hashKakaoSubject(subject: string): string {
  const value = subject.trim();
  if (!value) throw new Error("Kakao subject is required");
  return createHash("sha256").update(`kakao:${value}`).digest("hex");
}
