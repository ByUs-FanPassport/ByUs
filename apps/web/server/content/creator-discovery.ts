import type { PublishedCelebrity } from "./content-domain";

/** Editorial leads are independent of audience size. Shared by all discovery surfaces. */
export const MAIN_CREATOR_SLUGS: readonly string[] = ["elina", "changha", "yuna"];

export function isMainCreator(slug: string) {
  return MAIN_CREATOR_SLUGS.includes(slug);
}

export function orderCreatorsForDiscovery<T extends Pick<PublishedCelebrity, "slug" | "fanCount" | "displayOrder">>(creators: readonly T[]): T[] {
  return [...creators].sort((a, b) => {
    const aLead = MAIN_CREATOR_SLUGS.indexOf(a.slug);
    const bLead = MAIN_CREATOR_SLUGS.indexOf(b.slug);
    if (aLead >= 0 || bLead >= 0) {
      if (aLead < 0) return 1;
      if (bLead < 0) return -1;
      return aLead - bLead;
    }
    return b.fanCount - a.fanCount || a.displayOrder - b.displayOrder || a.slug.localeCompare(b.slug);
  });
}
