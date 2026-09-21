import type { AppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/features__creator__domain__creator-role";
import { additionalLocales } from "@/i18n/messages";
import { z } from "zod";

export const CREATOR_ROLES = ["idol", "singer", "actor", "creator", "show_host"] as const;
export const creatorRoleSchema = z.enum(CREATOR_ROLES);
export type CreatorRole = z.infer<typeof creatorRoleSchema>;
export type CreatorRoleFilter = CreatorRole | "all";
type Locale = AppLocale;

/** The public DTO retains its array shape, with exactly one representative role. */
export const creatorRolesSchema = z.array(creatorRoleSchema).length(1);

const labels = {
  ko: { idol: "아이돌", singer: "가수", actor: "배우", creator: "크리에이터", show_host: "쇼호스트" },
  en: { idol: "Idol", singer: "Singer", actor: "Actor", creator: "Creator", show_host: "Show host" },

  ...additionalLocales((translationLocale) => ({ idol: localizedMessages.m18490cca1879[translationLocale], singer: localizedMessages.m9d242e6de73e[translationLocale], actor: localizedMessages.m7e3bf59474a7[translationLocale], creator: localizedMessages.m0e6bfe41b999[translationLocale], show_host: localizedMessages.me86e2f21a7e0[translationLocale] }))
} as const;
const filterLabels = {
  ko: { all: "전체", ...labels.ko },
  en: { all: "All", idol: "Idols", singer: "Singers", actor: "Actors", creator: "Creators", show_host: "Show hosts" },

  ...additionalLocales((translationLocale) => ({ all: localizedMessages.mb53f545c208c[translationLocale], ...labels[translationLocale] }))
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
