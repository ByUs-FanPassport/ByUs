import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseCreatorReactionBatchRepository } from "./creator-reaction-batch-repository";

describe("owned creator reaction batch repository", () => {
  it("uses one service RPC and accepts a complete state set", async () => {
    const rpc = vi.fn(async () => ({ data: [{ slug: "kara", reacted: true }, { slug: "elina", reacted: false }], error: null }));
    const repository = new SupabaseCreatorReactionBatchRepository({ rpc });
    await expect(repository.findMany({ appUserId: "owner", celebritySlugs: ["kara", "elina"] })).resolves.toEqual([
      { slug: "kara", reacted: true }, { slug: "elina", reacted: false },
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_owned_creator_reactions", { p_app_user_id: "owner", p_celebrity_slugs: ["kara", "elina"] });
  });

  it.each([
    [{ slug: "kara", reacted: true }],
    [{ slug: "kara", reacted: true }, { slug: "kara", reacted: false }],
    [{ slug: "kara", reacted: true }, { slug: "elina" }],
    null,
  ])("rejects missing, duplicate, or malformed states instead of treating them as false", async (data) => {
    const repository = new SupabaseCreatorReactionBatchRepository({ rpc: vi.fn(async () => ({ data, error: null })) });
    await expect(repository.findMany({ appUserId: "owner", celebritySlugs: ["kara", "elina"] })).rejects.toMatchObject({ code: "REACTION_UNAVAILABLE" });
  });
});
