import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { connectionSchema, flowSchema, instagramMediaSchema, type InstagramConnection, type InstagramFlow, type InstagramLocale } from "./model";

export interface InstagramRepository {
  cleanup(): Promise<void>;
  issueInvite(input: { celebrityId: string; hash: string; username: string; userId: string | null; locale: InstagramLocale }): Promise<void>;
  transition(operation: string, hash: string, browserHash?: string, payload?: Record<string, unknown>): Promise<InstagramFlow | null>;
  disconnect(celebrityId: string, generation?: string): Promise<{ celebrity_id: string; identity: InstagramConnection["identity"] | null; token_ciphertext: string | null } | null>;
  deleteSubject(scopedId: string, issuedAt: string, confirmationHash: string): Promise<void>;
  deletionStatus(hash: string): Promise<boolean>;
  claimSync(celebrityId?: string): Promise<InstagramConnection[]>;
  finishSync(connection: InstagramConnection, result: Record<string, unknown>): Promise<boolean>;
  expireCredentials(celebrityId: string, generation: string): Promise<boolean>;
}

export function createInstagramRepository(db: SupabaseClient): InstagramRepository {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    // Supabase messages can contain SQL row values. Do not surface or log them.
    if (error) throw new Error("Instagram storage unavailable");
    return data;
  }
  return {
    async cleanup() {
      const now = new Date().toISOString();
      const results = await Promise.all(["instagram_connection_flows", "instagram_owner_flows", "instagram_deletion_receipts", "instagram_revocations"].map((table) => db.from(table).delete().lte("expires_at", now)));
      if (results.some((result) => result.error)) throw new Error("Instagram cleanup unavailable");
    },
    async issueInvite(input) {
      await rpc("instagram_issue_localized_invite", { p_celebrity_id: input.celebrityId, p_secret_hash: input.hash, p_username: input.username, p_user_id: input.userId, p_locale: input.locale });
    },
    async transition(operation, hash, browserHash, payload = {}) {
      const data = await rpc("instagram_transition", { p_operation: operation, p_secret_hash: hash, p_browser_hash: browserHash ?? null, p_payload: payload });
      return operation === "cancel" ? null : flowSchema.parse(data);
    },
    async disconnect(celebrityId, generation) {
      const data = await rpc("instagram_disconnect", { p_celebrity_id: celebrityId, p_generation: generation ?? null });
      if (data === null) return null;
      return z.object({ celebrity_id: z.string().uuid(), identity: connectionSchema.shape.identity.nullable(), token_ciphertext: z.string().nullable() }).parse(data);
    },
    async deleteSubject(scopedId, issuedAt, confirmationHash) {
      await rpc("instagram_delete_subject", { p_scoped_id: scopedId, p_issued_at: issuedAt, p_confirmation_hash: confirmationHash });
    },
    async deletionStatus(hash) {
      const { data, error } = await db.from("instagram_deletion_receipts").select("confirmation_hash").eq("confirmation_hash", hash).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (error) throw new Error("Instagram storage unavailable");
      return data !== null;
    },
    async claimSync(celebrityId) {
      return z.array(connectionSchema).parse(await rpc("instagram_claim_sync", { p_limit: celebrityId ? 1 : 10, p_celebrity_id: celebrityId ?? null }));
    },
    async finishSync(connection, result) {
      return z.boolean().parse(await rpc("instagram_finish_sync", { p_celebrity_id: connection.celebrity_id, p_generation: connection.generation, p_lease_id: connection.lease_id, p_result: result }));
    },
    async expireCredentials(celebrityId, generation) {
      return z.boolean().parse(await rpc("instagram_expire_credentials", { p_celebrity_id: celebrityId, p_generation: generation }));
    },
  };
}

export async function readInstagramMedia(db: SupabaseClient, slug: string, now = Date.now()) {
  const { data: celebrity, error: celebrityError } = await db.from("celebrities").select("id").eq("slug", slug).eq("status", "published").maybeSingle();
  if (celebrityError) throw new Error("Instagram media unavailable");
  if (!celebrity) return null;
  // Never fetch encrypted tokens in a public-read path, including unpublished responses.
  const { data, error } = await db.from("instagram_connections")
    .select("media,media_fetched_at,token_expires_at,last_error")
    .eq("celebrity_id", celebrity.id).maybeSingle();
  if (error) throw new Error("Instagram media unavailable");
  const fresh = data?.media_fetched_at && Date.parse(data.media_fetched_at) > now - 75 * 60_000;
  if (!fresh || !data?.token_expires_at || Date.parse(data.token_expires_at) <= now || data.last_error) return { items: [], updatedAt: null };
  return { items: z.array(instagramMediaSchema).max(3).parse(data.media), updatedAt: data.media_fetched_at as string };
}
