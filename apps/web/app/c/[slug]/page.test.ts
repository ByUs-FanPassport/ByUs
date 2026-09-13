import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => { throw new Error(`308:${url}`); },
  notFound: () => { throw new Error("404"); },
}));
import Page from "./page";

describe("legacy creator home redirect", () => {
  it("preserves locale, tabs, stored intent and repeated tracking values in one hop", async () => {
    await expect(Page({ params: Promise.resolve({ slug: "ifewknow" }), searchParams: Promise.resolve({ locale: "en", tab: "notice", authIntent: "old-intent", utm_source: ["a", "b"] }) }))
      .rejects.toThrow("308:/ifewknow?locale=en&tab=notice&authIntent=old-intent&utm_source=a&utm_source=b");
  });
  it("keeps the raffle catalog target rather than creating an extra home hop", async () => {
    await expect(Page({ params: Promise.resolve({ slug: "elina" }), searchParams: Promise.resolve({ tab: "benefits", locale: "ko" }) }))
      .rejects.toThrow("308:/c/elina/raffles?locale=ko");
  });
  it("does not redirect reserved service paths as creators", async () => {
    await expect(Page({ params: Promise.resolve({ slug: "login" }), searchParams: Promise.resolve({}) })).rejects.toThrow("404");
  });
});
