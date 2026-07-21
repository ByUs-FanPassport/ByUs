const allowedIntents = new Set(["reserve", "passport", "youtube", "tiktok", "instagram"]);

export type LoginContext = {
  returnTo: string;
  intent: string | null;
  entity: string | null;
  locale: "ko" | "en";
};

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

export function sanitizeEntity(value: string | null | undefined): string | null {
  return value && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(value) ? value : null;
}

export function sanitizeLocale(value: string | null | undefined): "ko" | "en" {
  return value === "en" ? "en" : "ko";
}

export function appendLoginContext(pathname: string, context: LoginContext): string {
  const query = new URLSearchParams({ returnTo: context.returnTo, locale: context.locale });
  if (context.intent) query.set("intent", context.intent);
  if (context.entity) query.set("entity", context.entity);
  return `${pathname}?${query.toString()}`;
}
