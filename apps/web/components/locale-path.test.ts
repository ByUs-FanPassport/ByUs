import { describe, expect, it } from "vitest";
import { requestLocale, withLocalePath } from "./locale-path";

describe("locale navigation", () => {
  it("preserves intent and anchors while synchronizing nested return paths", () => {
    const nested = '/c/kara/verify?locale=ko&authIntent=keep#quiz';
    const result = new URL(withLocalePath(`/onboarding/profile?locale=ko&returnTo=${encodeURIComponent(nested)}&intent=passport`, "en"), "https://byus.local");
    expect(result.searchParams.get("locale")).toBe("en");
    expect(result.searchParams.get("intent")).toBe("passport");
    expect(result.searchParams.get("returnTo")).toBe('/c/kara/verify?locale=en&authIntent=keep#quiz');
  });
  it.each(['https://evil.test/x', '//evil.test', '/\\evil.test', '/\nevil.test', 'relative'])('rejects unsafe path %s', (path) => {
    expect(withLocalePath(path, "en")).toBe('/?locale=en');
  });
  it("replaces unsafe nested paths and caps recursion", () => {
    expect(new URL(withLocalePath('/onboarding/profile?returnTo=https%3A%2F%2Fevil.test', 'en'), 'https://byus.local').searchParams.get('returnTo')).toBe('/?locale=en');
    let path = '/live/kara#live';
    for (let i = 0; i < 8; i++) path = `/onboarding/profile?returnTo=${encodeURIComponent(path)}`;
    const result = withLocalePath(path, 'en');
    expect(result.length).toBeLessThan(path.length);
    expect(result).not.toContain('undefined');
  });
  it("retains admin lang and limits cookie fallback to Kakao callback", () => {
    expect(withLocalePath('/admin/notices?lang=ko', 'en')).toBe('/admin/notices?lang=en');
    expect(requestLocale('/settings/kakao/callback', null, 'en')).toBe('en');
    expect(requestLocale('/settings/kakao/callback', 'ko', 'en')).toBe('ko');
    expect(requestLocale('/', null, 'en')).toBe('ko');
  });
});
