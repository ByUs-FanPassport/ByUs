import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthIntent, persistAuthIntent } from "../../../components/auth-intent";
import { FAN_ACTIVITY_UPDATED } from "../../../components/fan-ui/fan-activity-updates";
import { ReactionAction } from "./reaction-action";

const privy = vi.hoisted(() => ({
  ready: true,
  authenticated: true,
  user: { id: "owner-a" } as { id: string } | undefined,
  getAccessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token"),
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const reactionId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const existing = (mintStatus: "queued" | "minted" = "queued") => ({
  reactionId, status: "completed", mintStatus, blockchainJobId: jobId, created: false, passportExists: true,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const reactionIntentId = "33333333-3333-4333-8333-333333333333";

function prepareReactionIntent() {
  const intent = createAuthIntent({
    sourcePath: "/c/kara", sourceQuery: "?locale=ko", actionType: "CREATE_REACTION", targetType: "celebrity", targetId: "kara",
  }, { id: reactionIntentId });
  persistAuthIntent(sessionStorage, intent);
  window.history.replaceState({}, "", `/c/kara?locale=ko&authIntent=${intent.id}`);
}

describe("ReactionAction", () => {
  afterEach(() => {
    privy.ready = true;
    privy.authenticated = true;
    privy.user = { id: "owner-a" };
    privy.getAccessToken.mockReset().mockResolvedValue("token");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("restores an existing record in StrictMode without attempting a second POST", async () => {
    const fetch = vi.fn(async (_: RequestInfo | URL, _init?: RequestInit) => response({ reaction: existing("minted") }));
    vi.stubGlobal("fetch", fetch);

    render(<StrictMode><ReactionAction slug="kara" locale="ko" /></StrictMode>);

    expect(await screen.findByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();
    expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("does not enable mutation when the ownership lookup fails, and retries the lookup only", async () => {
    const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => undefined as unknown as Response)
      .mockResolvedValueOnce(response({ error: { code: "REACTION_UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(response({ reaction: null }));
    vi.stubGlobal("fetch", fetch);
    render(<ReactionAction slug="kara" locale="ko" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("좋아요 기록을 확인하지 못했어요");
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(await screen.findByRole("button", { name: "좋아요 남기기" })).toBeEnabled();
    expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("uses a synchronous lock so repeated clicks result in one POST, then notifies fan views", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    let reads = 0;
    const fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return post;
      reads += 1;
      return Promise.resolve(response({ reaction: reads === 1 ? null : existing("queued") }));
    });
    vi.stubGlobal("fetch", fetch);
    const update = vi.fn();
    window.addEventListener(FAN_ACTIVITY_UPDATED, update);
    render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: "좋아요 남기기" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "좋아요 남기기" }));
    fireEvent.click(screen.getByRole("button", { name: /남기는 중/ }));
    resolvePost(response({ ...existing("queued"), created: true, passportExists: false }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
    window.removeEventListener(FAN_ACTIVITY_UPDATED, update);
  });

  it("remounts state for an in-place Privy owner change instead of retaining the prior done CTA", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ reaction: existing("minted") }))
      .mockResolvedValueOnce(response({ reaction: null }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();

    privy.user = { id: "owner-b" };
    rerender(<ReactionAction slug="kara" locale="ko" />);

    expect(await screen.findByRole("button", { name: "좋아요 남기기" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("re-reads the owned status when a same-owner fan activity update is announced", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ reaction: existing("queued") }))
      .mockResolvedValueOnce(response({ reaction: existing("minted") }));
    vi.stubGlobal("fetch", fetch);
    render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();

    window.dispatchEvent(new CustomEvent(FAN_ACTIVITY_UPDATED, { detail: { ownerId: "owner-a" } }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();
  });

  it("ignores an aborted older lookup after a newer refresh completes", async () => {
    let resolveOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => { resolveOlder = resolve; });
    const fetch = vi.fn()
      .mockImplementationOnce(() => older)
      .mockResolvedValueOnce(response({ reaction: existing("minted") }));
    vi.stubGlobal("fetch", fetch);
    render(<ReactionAction slug="kara" locale="ko" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new CustomEvent(FAN_ACTIVITY_UPDATED, { detail: { ownerId: "owner-a" } }));
    expect(await screen.findByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();
    resolveOlder(response({ reaction: null }));
    await Promise.resolve();

    expect(screen.getByRole("button", { name: /좋아요를 남겼어요/ })).toBeDisabled();
  });

  it("does not send a POST when a delayed old-owner token resolves after an owner switch", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ reaction: null }))
      .mockResolvedValueOnce(response({ reaction: null }));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: "좋아요 남기기" })).toBeEnabled();

    let resolveOldToken!: (token: string | null) => void;
    const oldToken = new Promise<string | null>((resolve) => { resolveOldToken = resolve; });
    privy.getAccessToken.mockReset().mockImplementationOnce(() => oldToken).mockResolvedValue("token-b");
    fireEvent.click(screen.getByRole("button", { name: "좋아요 남기기" }));
    privy.user = { id: "owner-b" };
    rerender(<ReactionAction slug="kara" locale="ko" />);
    resolveOldToken("token-a");
    await screen.findByRole("button", { name: "좋아요 남기기" });
    await Promise.resolve();

    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("suppresses the old view's completion event when its pending POST resolves after unmount", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? post : Promise.resolve(response({ reaction: null })),
    );
    vi.stubGlobal("fetch", fetch);
    const update = vi.fn();
    window.addEventListener(FAN_ACTIVITY_UPDATED, update);
    const { unmount } = render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: "좋아요 남기기" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "좋아요 남기기" }));
    unmount();
    resolvePost(response({ ...existing("minted"), created: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(update).not.toHaveBeenCalled();
    window.removeEventListener(FAN_ACTIVITY_UPDATED, update);
  });

  it("resumes a pending auth intent once after a focus refresh confirms no existing record", async () => {
    let resolveInitial!: (value: Response) => void;
    const initial = new Promise<Response>((resolve) => { resolveInitial = resolve; });
    let reads = 0;
    const fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(response({ ...existing(), created: true, passportExists: false }));
      reads += 1;
      return reads === 1 ? initial : Promise.resolve(response({ reaction: null }));
    });
    vi.stubGlobal("fetch", fetch);
    prepareReactionIntent();
    render(<ReactionAction slug="kara" locale="ko" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    resolveInitial(response({ reaction: null }));
    await Promise.resolve();

    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("resumes a pending auth intent once after a failed initial lookup is retried successfully", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: "REACTION_UNAVAILABLE" } }, 503))
      .mockResolvedValueOnce(response({ reaction: null }))
      .mockResolvedValueOnce(response({ ...existing(), created: true, passportExists: false }));
    vi.stubGlobal("fetch", fetch);
    prepareReactionIntent();
    render(<ReactionAction slug="kara" locale="ko" />);
    expect(await screen.findByRole("button", { name: "다시 확인" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});
