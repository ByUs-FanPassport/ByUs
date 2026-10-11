import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creator: { slug: "runmusic", roles: ["brand"] as string[] },
  listPrimaryLives: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));

vi.mock("@/server/seo/public-content", () => ({ loadSeoCreator: vi.fn(async () => mocks.creator) }));
vi.mock("@/server/content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ listPrimaryLives: mocks.listPrimaryLives }) }));
vi.mock("@/components/celebrity-fan-page", () => ({ CelebrityFanPage: () => <div>Fan page</div> }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not-found"); }), redirect: mocks.redirect }));

import CelebrityPage from "./page";

describe("brand public page routing", () => {
  it("normalizes a raffle alias to brand home without loading LIVE", async () => {
    const page = await CelebrityPage({ params: Promise.resolve({ slug: "runmusic" }), searchParams: Promise.resolve({ locale: "ko", tab: "raffles" }) });
    expect(page).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.listPrimaryLives).not.toHaveBeenCalled();
  });
});
