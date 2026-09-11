// Browser identities are synthetic, available only in the standalone loopback test server.
const identity = localStorage.getItem("cs-test-identity") ?? "guest";
const authenticated = identity !== "guest";
const getAccessToken = async () => authenticated ? `cs-local-${identity}` : null;
const auth = { ready: true, authenticated, user: authenticated ? { id: `did:privy:cs-local-${identity}` } : null, getAccessToken };
export const usePrivy = () => auth;
