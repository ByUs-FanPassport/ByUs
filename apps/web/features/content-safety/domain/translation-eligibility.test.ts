import { describe, expect, it } from "vitest";
import { APP_LOCALES, type AppLocale } from "@/i18n/locales";
import { shouldOfferTranslation } from "./translation-eligibility";

describe("contextual translation eligibility", () => {
  it.each(["엘리나 유튜브 재개!!", "와!", "ㅋㅋㅋ", "엘리나 새 영상 올라왔어요! https://youtube.com/watch?v=abcdefghijk", "@ElinaKarimova 오늘 영상 너무 좋아요", "오늘도 KPOP 공연 정말 즐거웠어요", "안녕하세요".normalize("NFD")])("hides Korean text for Korean readers: %s", text => {
    expect(shouldOfferTranslation(text, "ko")).toBe(false);
    expect(shouldOfferTranslation(text, "en")).toBe(true);
  });
  it.each(APP_LOCALES)("hides language-free content for %s", locale => {
    for (const text of ["", "   ", "🎉❤️ 123!!!", "https://youtu.be/abc123", "www.youtube.com", "@ElinaKarimova", "fan@example.com"]) {
      expect(shouldOfferTranslation(text, locale)).toBe(false);
    }
  });
  it.each<[string, AppLocale]>([
    ["今日のライブは本当に楽しかったです！", "ja"],
    ["วันนี้สนุกมาก ขอบคุณทุกคนที่มาร่วมงาน", "th"],
    ["We are so excited to see everyone at the concert tonight!", "en"],
    ["Merci beaucoup de partager ce moment avec nous ce soir.", "fr"],
    ["Cảm ơn tất cả các bạn đã đến buổi biểu diễn hôm nay.", "vi"],
  ])("hides confidently matching language: %s", (text, locale) => {
    expect(shouldOfferTranslation(text, locale)).toBe(false);
    expect(shouldOfferTranslation(text, "ko")).toBe(true);
  });
  it.each(APP_LOCALES.filter(locale => locale !== "ko"))("offers Korean translation to %s readers", locale => {
    expect(shouldOfferTranslation("엘리나 유튜브 재개!!", locale)).toBe(true);
  });
  it.each<[string, AppLocale]>([
    ["Hello!", "en"], ["KARA", "en"], ["안녕! Hello everyone, see you at the concert!", "ko"],
    ["今天的演出非常精彩", "ja"], ["今天的演出非常精彩", "zh-Hans"], ["今天的演出非常精彩", "zh-Hant"],
    ["Terima kasih sudah datang ke konser kami hari ini semuanya.", "id"],
    ["Estoy muy feliz de compartir este momento con todos ustedes.", "es"],
    ["Estamos muito felizes por compartilhar este momento com vocês.", "pt"],
  ])("keeps manual translation for short, mixed, or ambiguous text: %s", (text, locale) => {
    expect(shouldOfferTranslation(text, locale)).toBe(true);
  });
});
