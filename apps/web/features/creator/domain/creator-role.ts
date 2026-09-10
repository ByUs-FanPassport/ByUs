import { z } from "zod";

export const CREATOR_ROLES = ["artist", "creator", "show_host"] as const;
export const creatorRoleSchema = z.enum(CREATOR_ROLES);
export type CreatorRole = z.infer<typeof creatorRoleSchema>;
export type CreatorRoleFilter = CreatorRole | "all";
type Locale = "ko" | "en";

/** The first role is representative; every assigned role participates in discovery. */
export const creatorRolesSchema = z.array(creatorRoleSchema).min(1).max(3).refine(
  (roles) => new Set(roles).size === roles.length,
  "Each role can only be selected once",
);

const labels = {
  ko: { artist: "아티스트", creator: "크리에이터", show_host: "쇼호스트" },
  en: { artist: "Artist", creator: "Creator", show_host: "Show host" },
} as const;
const filterLabels = {
  ko: { all: "전체", ...labels.ko },
  en: { all: "All", artist: "Artists", creator: "Creators", show_host: "Show hosts" },
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
  return filter === "all" || roles.includes(filter);
}

export function availableCreatorRoles(people: readonly { roles: readonly CreatorRole[] }[]) {
  return CREATOR_ROLES.filter((role) => people.some((person) => person.roles.includes(role)));
}

/** Selecting a new representative preserves the other activities without duplicates. */
export function withRepresentativeRole(roles: readonly CreatorRole[], primary: CreatorRole) {
  return [primary, ...roles.filter((role) => role !== primary)];
}
