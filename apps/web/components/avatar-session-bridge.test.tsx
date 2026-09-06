import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarSessionBridge, useAvatarSessionReady } from "./avatar-session-bridge";

const mock = vi.hoisted(() => ({
  auth: { ready: true, authenticated: true, user: { id: "fan-a" } as { id: string } | null, getAccessToken: vi.fn(async () => "privy-a") },
  grant: null as null | ((input: { oAuthTokens: { provider: string; accessToken: string; accessTokenExpiresInSeconds: number }; user: { id: string } }) => void),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => mock.auth,
  useOAuthTokens: ({ onOAuthTokenGrant }: { onOAuthTokenGrant: NonNullable<typeof mock.grant> }) => { mock.grant = onOAuthTokenGrant; },
}));

function Consumer({ owner = "fan-a" }: { owner?: string }) {
  const markReady = useAvatarSessionReady();
  return <button onClick={() => markReady(owner)}>Session ready</button>;
}
function tree(owner = "fan-a") { return <AvatarSessionBridge><Consumer owner={owner}/></AvatarSessionBridge>; }
function grant(owner = "fan-a", provider = "google") {
  act(() => mock.grant?.({ oAuthTokens: { provider, accessToken: "google-temporary", accessTokenExpiresInSeconds: 3600 }, user: { id: owner } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mock.auth = { ready: true, authenticated: true, user: { id: "fan-a" }, getAccessToken: vi.fn(async () => "privy-a") };
});

describe("optional Google avatar import bridge", () => {
  it.each(["grant-first", "session-first"])("waits for the matching session with %s ordering", async (ordering) => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const changed = vi.fn();
    window.addEventListener("byus:avatar-changed", changed);
    render(tree());
    if (ordering === "grant-first") grant(); else fireEvent.click(screen.getByText("Session ready"));
    expect(fetcher).not.toHaveBeenCalled();
    if (ordering === "grant-first") fireEvent.click(screen.getByText("Session ready")); else grant();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith("/api/me/avatar/import-google", expect.objectContaining({
      headers: { authorization: "Bearer privy-a", "content-type": "application/json" }, body: JSON.stringify({ accessToken: "google-temporary" }),
    }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(storage).not.toHaveBeenCalled();
    window.removeEventListener("byus:avatar-changed", changed);
  });

  it("retains a grant briefly when OAuth callback precedes authenticated state", async () => {
    mock.auth.authenticated = false;
    mock.auth.user = null;
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const view = render(tree());
    grant();
    expect(fetcher).not.toHaveBeenCalled();
    mock.auth.authenticated = true;
    mock.auth.user = { id: "fan-a" };
    view.rerender(tree());
    fireEvent.click(screen.getByText("Session ready"));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("does not import Apple grants or grants for another account", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(tree());
    fireEvent.click(screen.getByText("Session ready"));
    grant("fan-a", "apple");
    grant("fan-b");
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts in-flight imports on account switch and ignores late completion", async () => {
    let resolve: (value: Response) => void = () => {};
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    const changed = vi.fn();
    window.addEventListener("byus:avatar-changed", changed);
    const view = render(tree());
    fireEvent.click(screen.getByText("Session ready"));
    grant();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = (fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1].signal;
    mock.auth.user = { id: "fan-b" };
    view.rerender(tree("fan-b"));
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(new Response("{}")));
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener("byus:avatar-changed", changed);
  });

  it("does not surface provider/network errors or retry indefinitely", async () => {
    const fetcher = vi.fn(async () => { throw new Error("Provider unavailable"); });
    vi.stubGlobal("fetch", fetcher);
    render(tree());
    fireEvent.click(screen.getByText("Session ready"));
    grant();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Session ready")).toBeEnabled();
  });
});
