// New routes are excluded until their public-only data boundary is reviewed.
export function isPublicTelemetryPath(pathname: string): boolean {
  if (/(?:^|[/-])(?:rehearsal|test|demo)(?:[/-]|$)/i.test(pathname)) return false;
  return /^(?:\/|\/(?:celebrities|live|benefits|guide|privacy|terms))$/.test(pathname)
    || /^\/pages\/(?:partners|creator-onboarding|elina-fan-guide|ifew-fan-guide|us-fanmeetings)$/.test(pathname)
    || /^\/(?:live|benefits)\/[a-zA-Z0-9_-]+$/.test(pathname)
    || /^\/c\/[a-zA-Z0-9_-]+(?:\/(?:leaderboard|raffles(?:\/[a-zA-Z0-9_-]+)?|notices\/[a-zA-Z0-9_-]+))?$/.test(pathname);
}

export function sanitizeVercelTelemetry<T extends { type: string; url: string; route?: string }>(event: T): T | null {
  // Business events stay in our existing first-party analytics pipeline.
  if (event.type !== "pageview" && event.type !== "vital") return null;
  if (typeof window !== "undefined" && !isPublicTelemetryPath(window.location.pathname)) return null;
  if (event.route !== undefined && !isPublicTelemetryPath(event.route)) return null;
  try {
    const url = new URL(event.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !isPublicTelemetryPath(url.pathname)) return null;
    url.search = "";
    url.hash = "";
    return { ...event, url: url.href, ...(event.route !== undefined ? { route: url.pathname } : {}) };
  } catch {
    return null;
  }
}
