const EXACT_PROVIDERS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
] as const;

const REQUIRED_SUBDOMAIN_PROVIDERS = [
  "push.apple.com",
  "notify.windows.com",
] as const;

const hasDotBoundarySuffix = (hostname: string, suffix: string) =>
  hostname.endsWith(`.${suffix}`);

export function isTrustedWebPushEndpoint(endpoint: string): boolean {
  if (/\s|\\|[\u0000-\u001f\u007f-\u009f]/u.test(endpoint)) return false;
  if (endpoint.includes("#")) return false;

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;

    const hostname = url.hostname.toLowerCase();
    if (hostname === "jmt17.google.com")
      return url.pathname.startsWith("/fcm/send/");

    return (
      EXACT_PROVIDERS.some((provider) => hostname === provider) ||
      REQUIRED_SUBDOMAIN_PROVIDERS.some((provider) =>
        hasDotBoundarySuffix(hostname, provider),
      )
    );
  } catch {
    return false;
  }
}
