import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminSession } from "./use-admin-session";

const getAccessToken = vi.fn();
let privyState = { ready: true, authenticated: true };

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ...privyState, getAccessToken }),
}));

describe("useAdminSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    privyState = { ready: true, authenticated: true };
    getAccessToken.mockResolvedValue("privy-access-token");
  });

  it("sends the Privy bearer token and exposes only a validated 200 session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        admin: { email: "biz@sallylab.io", role: "admin" },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const { result } = renderHook(() => useAdminSession());
    await waitFor(() => expect(result.current.status).toBe("authorized"));

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/session", expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer privy-access-token" },
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/session", expect.objectContaining({
      method: "GET",
      headers: { authorization: "Bearer privy-access-token" },
      cache: "no-store",
    }));
  });

  it("fails closed when the server rejects the account", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }));

    const { result } = renderHook(() => useAdminSession());
    await waitFor(() => expect(result.current.status).toBe("denied"));
  });

  it("does not call the server before Privy authentication", async () => {
    privyState = { ready: true, authenticated: false };
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const { result } = renderHook(() => useAdminSession());
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
