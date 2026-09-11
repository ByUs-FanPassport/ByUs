"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

export type AdminSessionState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "denied" }
  | { status: "authorized"; admin: { email: string; role: string } };

export function useAdminSession(): AdminSessionState {
  const { ready, authenticated, getAccessToken, user } = usePrivy();
  const [verifiedOwner, setVerifiedOwner] = useState<string | null>(null);
  const [state, setState] = useState<AdminSessionState>({ status: "loading" });

  useEffect(() => {
    if (!ready) {
      setState({ status: "loading" });
      return;
    }
    if (!authenticated) {
      setState({ status: "unauthenticated" });
      return;
    }

    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (active) setState({ status: "unauthenticated" });
          return;
        }
        const syncResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!syncResponse.ok) throw new Error("Session synchronization failed");
        const response = await fetch("/api/admin/session", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          setState({ status: "unauthenticated" });
          return;
        }
        if (response.status === 403) {
          setState({ status: "denied" });
          return;
        }
        if (!response.ok) throw new Error("Admin session verification failed");
        const payload = (await response.json()) as { admin?: { email?: unknown; role?: unknown } };
        if (typeof payload.admin?.email !== "string" || typeof payload.admin.role !== "string") {
          throw new Error("Invalid admin session response");
        }
        if (!active) return;
        setVerifiedOwner(user?.id ?? null);
        setState({ status: "authorized", admin: { email: payload.admin.email, role: payload.admin.role } });
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "denied" });
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [authenticated, getAccessToken, ready, user?.id]);

  if (!ready) return { status: "loading" };
  if (!authenticated) return { status: "unauthenticated" };
  return state.status === "authorized" && verifiedOwner !== (user?.id ?? null) ? { status: "loading" } : state;
}
