import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Kakao browser route contract", () => {
  it.each(["start", "callback"])("exports only POST for the %s API route", (route) => {
    const source = readFileSync(resolve(process.cwd(), `app/api/me/connected-accounts/kakao/${route}/route.ts`), "utf8");
    expect(source).toMatch(/export async function POST\(/);
    expect(source).not.toMatch(/export async function GET\(/);
    expect(source).toContain("redirectUri:e.KAKAO_REDIRECT_URI");
    expect(source).not.toContain("/api/me/connected-accounts/kakao/callback`");
  });
});
