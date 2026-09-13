// Local harness only. Never reads or submits a real identity.
const getAccessToken = async () => "banner-local-synthetic-token";
export function usePrivy() {
  return { ready: true, authenticated: false, user: null, login: () => undefined, getAccessToken };
}
