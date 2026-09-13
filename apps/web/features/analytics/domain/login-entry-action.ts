import { creatorSlugFromHomePath } from "@/features/creator/domain/creator-navigation";
import { z } from "zod";

export const loginEntryActionSchema = z.enum(["daily_checkin", "cheer", "passport_share", "other"]);
export type LoginEntryAction = z.infer<typeof loginEntryActionSchema>;

/** Classify the existing local return target; never retain or emit its value. */
export function classifyLoginEntryAction(href: string): LoginEntryAction {
  try {
    const login = new URL(href);
    if (login.pathname !== "/login") return "other";
    const raw = login.searchParams.get("returnTo");
    if (!raw?.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "other";
    const target = new URL(raw, login.origin);
    if (target.origin !== login.origin) return "other";
    if (creatorSlugFromHomePath(target.pathname) !== null) {
      if (target.hash === "#daily-checkin") return "daily_checkin";
      if (target.hash === "#cheers") return "cheer";
    }
    if (/^\/s\/[a-f0-9]{32}$/.test(target.pathname)) return "passport_share";
  } catch { /* Malformed or unavailable location does not affect sign-in. */ }
  return "other";
}
