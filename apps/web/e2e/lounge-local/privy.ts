// Synthetic verifier is confined to this standalone loopback harness.
import { useSyncExternalStore } from "react";
const subscribe = (callback: () => void) => { window.addEventListener("lounge-identity", callback); return () => window.removeEventListener("lounge-identity", callback); };
const read = () => localStorage.getItem("lounge-test-identity") ?? "guest";
const tokens = new Map<string, () => Promise<string | null>>();
export function usePrivy() {
  const identity = useSyncExternalStore(subscribe, read, () => "guest");
  if (!tokens.has(identity)) tokens.set(identity, async () => identity === "guest" ? null : `lounge-local-${identity}`);
  return { ready: true, authenticated: identity !== "guest", user: identity === "guest" ? null : { id: `did:privy:lounge-local-${identity}` }, getAccessToken: tokens.get(identity)! };
}
