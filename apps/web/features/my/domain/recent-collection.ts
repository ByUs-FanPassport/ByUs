import type { MySummary } from "./my-summary";

type CollectionItem = MySummary["collection"]["recent"][number];
export type RecentCollectionGroup = { item: CollectionItem; count: number };

/** Combine stamps that display identically and open the same Passport, preserving the first item's order. */
export function groupRecentCollection(items: CollectionItem[]): RecentCollectionGroup[] {
  const groups = new Map<string, RecentCollectionGroup>();
  for (const item of items) {
    const key = item.kind === "stamp"
      ? JSON.stringify([item.kind, item.href, item.title, Math.floor(Date.parse(item.occurredAt) / 60_000)])
      : `${item.kind}:${item.id}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { item, count: 1 });
  }
  return [...groups.values()];
}

export function collectionGroupTitle({ item, count }: RecentCollectionGroup, locale: "ko" | "en") {
  const title = locale === "ko" && item.kind === "stamp" ? item.title.replace(/ Stamp$/, " 스탬프") : item.title;
  return count > 1 ? `${title}${locale === "ko" ? ` ${count}개` : ` ×${count}`}` : title;
}
