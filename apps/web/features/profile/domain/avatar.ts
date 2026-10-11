import { z } from "zod";

export const AVATAR_CHARACTER_IDS = [
  "star-cream",
  "star-pink",
  "star-lavender",
  "heart-cream",
  "heart-pink",
  "heart-lavender",
  "fairy-cream",
  "fairy-pink",
  "fairy-lavender",
  "ghost-cream",
  "ghost-pink",
  "ghost-lavender",
] as const;

export const avatarCharacterIdSchema = z.enum(AVATAR_CHARACTER_IDS);
export type AvatarCharacterId = z.infer<typeof avatarCharacterIdSchema>;

export const publicAvatarUrlSchema = z.string().refine((value) => {
  if (/^\/images\/avatars\/(?:star|heart|fairy|ghost)-(?:cream|pink|lavender)\.webp$/.test(value)) return true;
  const match = /^\/api\/fan-avatars\/([^/?#]+)\?revision=(0|[1-9][0-9]{0,9})$/.exec(value);
  return match !== null && z.uuid().safeParse(match[1]).success && Number(match[2]) <= 2147483647;
}, "Invalid public avatar URL");

export const AVATAR_CHARACTER_CATALOG = AVATAR_CHARACTER_IDS.map((id) => ({
  id,
  assetPath: `/images/avatars/${id}.webp`,
})) satisfies ReadonlyArray<{ id: AvatarCharacterId; assetPath: string }>;

export const avatarSourceSchema = z.enum([
  "default",
  "google",
  "upload",
  "character",
  "removed",
]);
export type AvatarSource = z.infer<typeof avatarSourceSchema>;

export const avatarSchema = z
  .object({
    initialCharacterId: avatarCharacterIdSchema,
    characterId: avatarCharacterIdSchema,
    source: avatarSourceSchema,
    hasImage: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type Avatar = z.infer<typeof avatarSchema>;

export const avatarResponseSchema = z.object({ avatar: avatarSchema }).strict();

export const avatarCropSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    size: z.number().finite().gt(0).max(1),
  })
  .strict();
export type AvatarCrop = z.infer<typeof avatarCropSchema>;

export function avatarAssetPath(id: AvatarCharacterId): string {
  return `/images/avatars/${id}.webp`;
}
