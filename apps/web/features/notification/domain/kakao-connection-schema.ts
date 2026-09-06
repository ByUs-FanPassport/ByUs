import { z } from "zod";

export const kakaoConnectionCallbackSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  state: z.string().trim().min(32).max(512),
}).strict();

export const kakaoProviderErrorSchema = z.string().trim().min(1).max(256);

export const safeKakaoReturnPathSchema = z.string().trim().max(2048).refine((value) => {
  if (!/^\/(?:my|settings)(?:\?[^#]*)?$/.test(value)) return false;
  try {
    const parsed = new URL(value, "https://byus.invalid");
    return parsed.origin === "https://byus.invalid" &&
      (parsed.pathname === "/my" || parsed.pathname === "/settings") &&
      !parsed.hash;
  } catch {
    return false;
  }
}, "must be a local settings or my path");

export const kakaoConnectionCallbackResponseSchema = z.object({
  returnPath: safeKakaoReturnPathSchema,
}).passthrough();

export type KakaoConnectionCallback = z.infer<typeof kakaoConnectionCallbackSchema>;
