import "server-only";
import { cache } from "react";
import type { ContentLocale, PublishedCelebrity } from "../content/content-domain";
import { createPublishedContentRepositoryFromEnvironment } from "../content/published-content-repository";
import { createPublicImageRoleReader } from "./public-image-reader";
import { ifewLiveSlug } from "../../components/ifew-fan-guide/content";
import type { PhotoSet } from "../../features/media/domain/public-image";

export type GuideCelebrity = Pick<PublishedCelebrity, "slug" | "image">;
export type GuideImages = { celebrity: GuideCelebrity | null; eventPhotos: PhotoSet | undefined };

/** Request-scoped sharing keeps page, metadata, and home guide artwork on the same public roles. */
export const loadGuideEventPhotos = cache(async (): Promise<PhotoSet | undefined> => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Guide images are not configured");
  const photos = await createPublicImageRoleReader({ url, serviceRoleKey }).readLivePhotoSetsBySlug([ifewLiveSlug]);
  return photos[ifewLiveSlug];
});

export const loadGuideImages = cache(async (locale: ContentLocale, creator: "elina" | "ifew"): Promise<GuideImages> => {
  const [celebrity, eventPhotos] = await Promise.all([
    createPublishedContentRepositoryFromEnvironment().findBySlug(locale, creator === "ifew" ? "ifewknow" : creator),
    creator === "ifew" ? loadGuideEventPhotos() : undefined,
  ]);
  return { celebrity, eventPhotos };
});
