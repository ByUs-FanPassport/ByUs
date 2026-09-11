// This synthetic identity exists only in the loopback Vite harness. It never
// reads a real browser session, Privy account, wallet, or production token.
const allowedScenarios = new Set(["fresh", "wrong-quiz", "already-completed", "retry"]);

function scenario() {
  const value = new URLSearchParams(location.search).get("scenario") ?? "fresh";
  return allowedScenarios.has(value) ? value : "fresh";
}

export function usePrivy() {
  const selected = scenario();
  return {
    ready: true,
    authenticated: true,
    user: { id: "did:privy:mission-local-testowner" },
    login: () => undefined,
    getAccessToken: async () => `mission-local-testowner:${selected}`,
  };
}
