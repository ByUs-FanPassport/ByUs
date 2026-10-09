import "server-only";
import { chzzkChannelId } from "@/features/fanpage/domain/chzzk-posts";
import { readChzzkWindow } from "@/server/chzzk/community";
import { createPublishedContentRepositoryFromEnvironment } from "@/server/content/published-content-repository";
import { createFanpageDependencies } from "@/server/fanpage/dependencies";
import type { FeedDependencies } from "./feed";

export function createFeedDependencies(): FeedDependencies {
  const dependencies = createFanpageDependencies();
  const published = createPublishedContentRepositoryFromEnvironment();
  return {
    ...dependencies,
    async chzzkChannel(slug, locale) {
      const creator = await published.findBySlug(locale, slug);
      return creator ? chzzkChannelId(creator.socialLinks) : null;
    },
    readChzzk: readChzzkWindow,
  };
}
