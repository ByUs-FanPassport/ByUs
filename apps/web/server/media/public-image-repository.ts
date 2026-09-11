import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "../admin/admin-session-gate";
import type { ImageRoleRecord, PublicImageAsset } from "../../features/media/domain/public-image";
import { imageRoleRecordSchema, imageRoleWriteSchema, publicImageAssetSchema } from "./image-schemas";
import { fetchCurrentCmsAsset, normalizePublicImage, PublicImageError, type NormalizedPublicImage } from "./public-image-processing";
import type { z } from "zod";

type Client = Pick<SupabaseClient, "rpc" | "storage">;
type Write = z.infer<typeof imageRoleWriteSchema>;

function duplicateUpload(error: { message?: string; statusCode?: string | number } | null): boolean {
  return Boolean(error && (Number(error.statusCode) === 409 || /duplicate|already exists/i.test(error.message ?? "")));
}
function repositoryError(error: { message: string } | null): never {
  const message = error?.message ?? "public image repository unavailable";
  throw new PublicImageError(/revision conflict/i.test(message) ? "CONFLICT" : /invalid|not found|requires|read-only|mismatch/i.test(message) ? "INVALID_SOURCE" : "UNAVAILABLE");
}

export class PublicImageRepository {
  constructor(private readonly db: Client, private readonly supabaseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async downloadCurrentCmsAsset(source: string): Promise<Uint8Array> {
    return fetchCurrentCmsAsset(source, this.supabaseUrl, this.fetcher);
  }

  async register(actor: AdminSession, correlationId: string, image: NormalizedPublicImage): Promise<PublicImageAsset> {
    const storagePath = `public-image-assets/${image.sha256}.webp`;
    const bucket = this.db.storage.from("cms-assets");
    const uploaded = await bucket.upload(storagePath, image.bytes, { contentType: image.mimeType, cacheControl: "public, max-age=31536000, immutable", upsert: false });
    if (uploaded.error && !duplicateUpload(uploaded.error)) repositoryError(uploaded.error);
    const url = bucket.getPublicUrl(storagePath).data.publicUrl;
    const { data, error } = await this.db.rpc("register_admin_public_image_asset", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
      p_correlation_id: correlationId, p_content_sha256: image.sha256, p_storage_path: storagePath,
      p_url: url, p_width: image.width, p_height: image.height, p_mime_type: image.mimeType,
      p_byte_size: image.bytes.byteLength,
    });
    if (error) repositoryError(error);
    return publicImageAssetSchema.parse(data);
  }

  async normalizeAndRegister(actor: AdminSession, correlationId: string, bytes: Uint8Array) {
    return this.register(actor, correlationId, await normalizePublicImage(bytes));
  }

  async listRoles(actor: AdminSession, ownerType: Write["ownerType"], ownerId: string): Promise<ImageRoleRecord[]> {
    const { data, error } = await this.db.rpc("read_admin_public_image_roles", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
      p_owner_type: ownerType, p_owner_id: ownerId,
    });
    if (error) repositoryError(error);
    return imageRoleRecordSchema.array().parse(data);
  }

  async setRole(actor: AdminSession, correlationId: string, input: Write): Promise<ImageRoleRecord> {
    const { data, error } = await this.db.rpc("set_admin_public_image_role", {
      p_actor_app_user_id: actor.appUserId, p_actor_admin_allowlist_id: actor.allowlistId,
      p_correlation_id: correlationId, p_owner_type: input.ownerType, p_owner_id: input.ownerId,
      p_role: input.role, p_expected_revision: input.expectedRevision,
      p_asset_id: input.binding?.assetId ?? null, p_alt: input.binding?.alt ?? null,
      p_frames: input.binding?.frames ?? {},
    });
    if (error) repositoryError(error);
    return imageRoleRecordSchema.parse(data);
  }
}

export function createPublicImageRepository(config: { url: string; serviceRoleKey: string }, client?: Client) {
  return new PublicImageRepository(client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), config.url);
}
