// Synthetic loopback identity only; no real session, wallet, or production token.
const isGuest = new URLSearchParams(location.search).get("scenario") === "guest";
const auth = { ready: true, authenticated: !isGuest, user: isGuest ? null : { id: "tickets-local-owner" }, getAccessToken: async () => isGuest ? null : "tickets-local-token", login: () => undefined };
export function usePrivy() { return auth; }
export function useCreateWallet() { return { createWallet: async () => undefined }; }
export function useUser() { return { refreshUser: async () => ({ id: "tickets-local-owner", linkedAccounts: [] }) }; }
export function useOAuthTokens(_callbacks: unknown) {}
