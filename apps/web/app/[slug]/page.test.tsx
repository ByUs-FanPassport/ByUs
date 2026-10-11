import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creator: { slug: "runmusic", roles: ["brand"] as string[] },
  listPrimaryLives: vi.fn(async () => [{ slug: "festival-live", celebritySlug: "runmusic" }]),
  redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }),
}));

vi.mock("@/server/seo/public-content", () => ({ loadSeoCreator: vi.fn(async () => mocks.creator) }));
vi.mock("@/server/content/published-content-repository", () => ({ createPublishedContentRepositoryFromEnvironment: () => ({ listPrimaryLives: mocks.listPrimaryLives }) }));
vi.mock("@/components/celebrity-fan-page", () => ({ CelebrityFanPage: () => <div>Fan page</div> }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("not-found"); }), redirect: mocks.redirect }));

import CelebrityPage from "./page";

describe("brand public page routing", () => {
  it.each(["raffles", "benefits"])("preserves the shared %s catalog and auth intent", async (tab) => {
    const authIntent = "11111111-1111-4111-8111-111111111111";
    await expect(CelebrityPage({ params: Promise.resolve({ slug: "runmusic" }), searchParams: Promise.resolve({ locale: "ja", tab, authIntent }) }))
      .rejects.toThrow(`redirect:/c/runmusic/raffles?locale=ja&authIntent=${authIntent}`);
  });

  it.each(["live", "media"])("loads the shared brand %s destination", async (tab) => {
    const page = await CelebrityPage({ params: Promise.resolve({ slug: "runmusic" }), searchParams: Promise.resolve({ locale: "ko", tab }) });
    expect(page.props.children[0].props).toMatchObject({
      initialTab: "board", initialBoardSection: tab,
      upcomingLive: { slug: "festival-live", celebritySlug: "runmusic" },
    });
    expect(mocks.listPrimaryLives).toHaveBeenCalledWith("ko");
  });
});
