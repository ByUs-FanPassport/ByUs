"use client";

import { useOAuthTokens, usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const SessionAvatarContext = createContext<(privyUserId: string) => void>(() => {});

/** Login synchronization remains independent of this optional photo import. */
export function useAvatarSessionReady() {
  return useContext(SessionAvatarContext);
}

interface PendingGrant {
  owner: string;
  token: string;
  expiresAt: number;
}

export function AvatarSessionBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const owner = ready && authenticated ? user?.id ?? null : null;
  const [grant, setGrant] = useState<PendingGrant | null>(null);
  const [synchronizedOwner, setSynchronizedOwner] = useState<string | null>(null);
  const previousOwner = useRef<string | null>(null);
  const markReady = useCallback((privyUserId: string) => setSynchronizedOwner(privyUserId), []);

  useOAuthTokens({
    onOAuthTokenGrant: ({ oAuthTokens, user: oauthUser }) => {
      if (oAuthTokens.provider !== "google" || !oAuthTokens.accessToken) return;
      // The token lives only in this mounted bridge, never in browser storage.
      setGrant({
        owner: oauthUser.id,
        token: oAuthTokens.accessToken,
        expiresAt: Date.now() + Math.min(oAuthTokens.accessTokenExpiresInSeconds ?? 60, 60) * 1000,
      });
    },
  });

  useEffect(() => {
    if (!ready) return;
    // OAuth grants can precede Privy's authenticated state on the return page.
    // Keep that initial grant briefly, but clear it on an actual account exit.
    if (owner || previousOwner.current) {
      setGrant((current) => current?.owner === owner ? current : null);
    }
    previousOwner.current = owner;
    setSynchronizedOwner((current) => current === owner ? current : null);
  }, [owner, ready]);

  useEffect(() => {
    if (!grant) return;
    const timer = window.setTimeout(() => setGrant((current) => current === grant ? null : current), Math.max(0, grant.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [grant]);

  useEffect(() => {
    if (!owner || synchronizedOwner !== owner || grant?.owner !== owner || grant.expiresAt <= Date.now()) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken || controller.signal.aborted || grant.expiresAt <= Date.now()) return;
        const response = await fetch("/api/me/avatar/import-google", {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify({ accessToken: grant.token }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok && !controller.signal.aborted) {
          window.dispatchEvent(new CustomEvent("byus:avatar-changed", { detail: { privyUserId: owner } }));
        }
      } catch {
        // Photos are optional: no provider failure may reject the login flow.
      } finally {
        if (!controller.signal.aborted) setGrant((current) => current === grant ? null : current);
      }
    })();
    return () => controller.abort();
  }, [grant, owner, synchronizedOwner, getAccessToken]);

  return <SessionAvatarContext.Provider value={markReady}>{children}</SessionAvatarContext.Provider>;
}
