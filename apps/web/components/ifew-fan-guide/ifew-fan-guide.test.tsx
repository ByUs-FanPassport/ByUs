import { describe, expect, it, vi } from "vitest";
import Page from "../../app/pages/ifew-fan-guide/page";

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
}));

describe("retired ifew LIVE participation guide", () => {
  it.each(["ko", "en"] as const)("redirects existing %s links to the LIVE record", async (locale) => {
    await expect(Page({ searchParams: Promise.resolve({ locale }) }))
      .rejects.toThrow(`REDIRECT:/live/ifew-100-days-tiktok-20260912?locale=${locale}`);
  });

  it.each(["fr", ["en", "ko"], undefined])("uses Korean for unsupported locale %j", async (locale) => {
    await expect(Page({ searchParams: Promise.resolve({ locale }) }))
      .rejects.toThrow("REDIRECT:/live/ifew-100-days-tiktok-20260912?locale=ko");
  });
});
