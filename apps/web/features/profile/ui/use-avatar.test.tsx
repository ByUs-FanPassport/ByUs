import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAvatarChanged } from "./avatar-events";
import { useAvatar } from "./use-avatar";

const { auth, getAccessToken } = vi.hoisted(() => ({
  auth: { ready: true, authenticated: true, user: { id: "owner-a" } as { id: string } | undefined },
  getAccessToken: vi.fn(async () => "token" as string | null),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...auth, getAccessToken }),
}));

const avatar = (characterId = "star-cream", revision = 1, hasImage = true) => ({
  avatar: {
    initialCharacterId: "star-cream",
    characterId,
    source: hasImage ? "upload" : "character",
    hasImage,
    revision,
  },
});

const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

beforeEach(() => {
  auth.ready = true;
  auth.authenticated = true;
  auth.user = { id: "owner-a" };
  getAccessToken.mockReset().mockResolvedValue("token");
  vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:owner-a").mockReturnValue("blob:next");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private avatar resource", () => {
  it("loads the authenticated image and refreshes only for the same owner", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/image?")
        ? new Response(new Blob(["image"], { type: "image/webp" }))
        : Response.json(avatar()),
    );
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useAvatar());

    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready", imageUrl: "blob:owner-a" }));
    expect(fetcher).toHaveBeenCalledWith("/api/me/avatar/image?revision=1", expect.objectContaining({ headers: { Authorization: "Bearer token" } }));
    await act(async () => { notifyAvatarChanged("owner-b"); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { notifyAvatarChanged("owner-a"); await flush(); });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("clears the old owner immediately, aborts their request, and ignores its delayed response", async () => {
    let resolveOld!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json(avatar("heart-pink", 2, false)));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(() => useAvatar());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    auth.user = { id: "owner-b" };
    rerender();
    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready", avatar: { characterId: "heart-pink" } }));
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);

    await act(async () => { resolveOld(Response.json(avatar("ghost-cream", 1, false))); await flush(); });
    expect(result.current.state).toMatchObject({ status: "ready", avatar: { characterId: "heart-pink" } });
  });

  it("revokes private blob URLs when the owner changes and on unmount", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/image?")
        ? new Response(new Blob(["image"], { type: "image/webp" }))
        : Response.json(avatar()),
    );
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender, unmount } = renderHook(() => useAvatar());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    auth.user = { id: "owner-b" };
    rerender();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owner-a"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:next");
  });

  it("keeps the catalog fallback ready when the private image request fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(avatar("ghost-lavender")))
      .mockRejectedValueOnce(new Error("image unavailable"));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useAvatar());
    await waitFor(() => expect(result.current.state).toMatchObject({
      status: "ready",
      avatar: { characterId: "ghost-lavender" },
      imageUrl: null,
    }));
  });
});
