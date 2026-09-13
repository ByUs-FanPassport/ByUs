import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PhotoSet } from "../../features/media/domain/public-image";
import { imageRoleRecordSchema, recordsToPhotoSet } from "./image-schemas";

type RpcClient = Pick<SupabaseClient, "rpc">;
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const rowSchema = z.object({ ownerSlug: slug, record: imageRoleRecordSchema }).strict();
const RPC_SLUG_LIMIT = 200;

export interface PublicImageRoleReader {
  readCelebrityPhotoSetsBySlug(slugs: readonly string[]): Promise<Record<string, PhotoSet>>;
  readLivePhotoSetsBySlug(slugs: readonly string[]): Promise<Record<string, PhotoSet>>;
}

export class SupabasePublicImageRoleReader implements PublicImageRoleReader {
  constructor(private readonly db: RpcClient) {}
  private async read(ownerType: "celebrity" | "live", values: readonly string[]): Promise<Record<string, PhotoSet>> {
    const unique = [...new Set(z.array(slug).parse(values))];
    if (unique.length === 0) return {};
    const chunks = Array.from(
      { length: Math.ceil(unique.length / RPC_SLUG_LIMIT) },
      (_, index) => unique.slice(index * RPC_SLUG_LIMIT, (index + 1) * RPC_SLUG_LIMIT),
    );
    const responses = await Promise.all(chunks.map(async (slugs) => {
      const { data, error } = await this.db.rpc("read_published_public_image_roles", { p_owner_type: ownerType, p_slugs: slugs });
      if (error) throw new Error(`public image role read failed: ${error.message}`);
      return rowSchema.array().parse(data);
    }));
    const rows = responses.flat();
    const grouped = new Map<string, ReturnType<typeof imageRoleRecordSchema.parse>[]>();
    for (const row of rows) {
      const records = grouped.get(row.ownerSlug) ?? [];
      if (records.some(record => record.role === row.record.role)) throw new Error("duplicate public image role");
      records.push(row.record); grouped.set(row.ownerSlug, records);
    }
    return Object.fromEntries([...grouped].map(([ownerSlug, records]) => [ownerSlug, recordsToPhotoSet(records)]));
  }
  readCelebrityPhotoSetsBySlug(slugs: readonly string[]) { return this.read("celebrity", slugs); }
  readLivePhotoSetsBySlug(slugs: readonly string[]) { return this.read("live", slugs); }
}

export function createPublicImageRoleReader(config: { url: string; serviceRoleKey: string }, client?: RpcClient): PublicImageRoleReader {
  return new SupabasePublicImageRoleReader(client ?? createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
}
