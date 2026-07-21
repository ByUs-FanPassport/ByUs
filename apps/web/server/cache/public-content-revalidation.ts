import "server-only";

import { revalidateTag } from "next/cache";

import { PUBLIC_CONTENT_CACHE_TAG } from "./public-content-cache";

/** Deletes the tagged response cache so the first post-publication read is fresh. */
export function invalidatePublicContentCache(): void {
  revalidateTag(PUBLIC_CONTENT_CACHE_TAG, { expire: 0 });
}
