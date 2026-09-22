import { describe, expect, it, vi } from "vitest";
import Page from "../../app/pages/elina-fan-guide/page";

vi.mock("next/navigation", () => ({
  permanentRedirect: (href: string) => { throw new Error(`redirect:${href}`); },
}));

describe("retired Elina LIVE guide", () => {
  it.each([
    ["ko", "/c/elina/raffles?locale=ko"],
    ["en", "/c/elina/raffles?locale=en"],
    ["de", "/c/elina/raffles?locale=ko"],
  ])("redirects %s visitors to the open raffle", async (locale, href) => {
    await expect(Page({ searchParams: Promise.resolve({ locale }) })).rejects.toThrow(`redirect:${href}`);
  });
});
