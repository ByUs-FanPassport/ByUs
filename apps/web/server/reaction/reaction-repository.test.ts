import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { SupabaseReactionRepository } from "./reaction-repository";
import { createGetReactionHandler, createPostReactionHandler } from "./reaction-route";

const reactionId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const outboxId = "33333333-3333-4333-8333-333333333333";
const existing = { reactionId, status: "completed", mintStatus: "minted", blockchainJobId: jobId, created: false, passportExists: true };

function setup(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  const client = {
    rpc,
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: reactionId }, error: null }) }) }) })),
  };
  const repository = new SupabaseReactionRepository(client, () => jobId);
  const authorize = vi.fn(async () => ({ appUserId: "owner" }));
  return { repository, rpc, deps: { repository, authorize } };
}

describe("creator reaction RPC response compatibility", () => {
  it.each([
    ["legacy", existing],
    ["Fan Action", { ...existing, blockchainJobId: null }],
  ])("returns an owned %s reaction without turning a saved like into 503", async (_, data) => {
    const { deps, rpc } = setup(data);
    const response = await createGetReactionHandler(deps)(new Request("https://byus.kr/api/celebrities/changha/reactions"), { celebritySlug: "changha" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reaction: data });
    expect(rpc).toHaveBeenCalledWith("get_owned_reaction", { p_app_user_id: "owner", p_celebrity_slug: "changha" });
  });

  it.each([
    ["legacy", { ...existing, fanActionOutboxId: null }],
    ["new Fan Action", { ...existing, blockchainJobId: null, fanActionOutboxId: outboxId, mintStatus: "queued", created: true }],
    ["existing Fan Action", { ...existing, blockchainJobId: null, fanActionOutboxId: outboxId }],
  ])("returns successful %s writes using the current RPC contract", async (_, data) => {
    const { deps, rpc } = setup(data);
    const response = await createPostReactionHandler(deps)(new Request("https://byus.kr/api/celebrities/changha/reactions", { method: "POST" }), { celebritySlug: "changha" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves the no-reaction result", async () => {
    const { repository } = setup(null);
    await expect(repository.find({ appUserId: "owner", celebritySlug: "changha" })).resolves.toBeNull();
  });

  it.each([
    { ...existing, blockchainJobId: "invalid" },
    { ...existing, fanActionOutboxId: "invalid" },
    { ...existing, unexpected: true },
    { ...existing, blockchainJobId: undefined },
  ])("still rejects malformed or unexpected response fields", async (data) => {
    const { repository } = setup(data);
    await expect(repository.find({ appUserId: "owner", celebritySlug: "changha" })).rejects.toMatchObject({ code: "REACTION_UNAVAILABLE" });
  });
});
