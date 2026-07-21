const allowedIntents = new Set(["reserve", "passport", "youtube", "tiktok", "instagram"]);

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";

  try {
    const origin = "https://byus.local";
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return "/";
    if (parsed.pathname === "/login") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function sanitizeIntent(value: string | null | undefined): string | null {
  return value && allowedIntents.has(value) ? value : null;
}
