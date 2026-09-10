import { z } from "zod";

export const CREATOR_ROLES = ["idol", "singer", "actor", "creator", "show_host"] as const;
export const creatorRoleSchema = z.enum(CREATOR_ROLES);
export type CreatorRole = z.infer<typeof creatorRoleSchema>;
export type CreatorRoleFilter = CreatorRole | "all";
type Locale = "ko" | "en";

/** The public DTO retains its array shape, with exactly one representative role. */
export const creatorRolesSchema = z.array(creatorRoleSchema).length(1);

const labels = {
  ko: { idol: "아이돌", singer: "가수", actor: "배우", creator: "크리에이터", show_host: "쇼호스트" },
  en: { idol: "Idol", singer: "Singer", actor: "Actor", creator: "Creator", show_host: "Show host" },
} as const;
const filterLabels = {
  ko: { all: "전체", ...labels.ko },
  en: { all: "All", idol: "Idols", singer: "Singers", actor: "Actors", creator: "Creators", show_host: "Show hosts" },
} as const;

export function creatorRoleLabel(role: CreatorRole, locale: Locale) {
  return labels[locale][role];
}

export function creatorRoleFilterLabel(role: CreatorRoleFilter, locale: Locale) {
  return filterLabels[locale][role];
}

export function parseCreatorRoleFilter(value: unknown): CreatorRoleFilter {
  const result = creatorRoleSchema.safeParse(value);
  return result.success ? result.data : "all";
}

export function matchesCreatorRole(roles: readonly CreatorRole[], filter: CreatorRoleFilter) {
  return filter === "all" || roles[0] === filter;
}

export function availableCreatorRoles(people: readonly { roles: readonly CreatorRole[] }[]) {
  return CREATOR_ROLES.filter((role) => people.some((person) => person.roles[0] === role));
}
