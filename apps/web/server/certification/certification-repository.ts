import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  certificationListItemSchema, historyItemSchema, manualCertificationSchema, submissionSchema,
  type CertificationHistoryItem, type CertificationListItem, type CertificationLocale, type CertificationSubmission, type ManualCertification,
} from "../../features/certification/domain/certification";

type RpcError = { message?: string; code?: string } | null;
const commandSchema = z.object({ id: z.uuid(), status: z.string(), revision: z.number().int().positive() }).passthrough();

export class CertificationRepositoryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CertificationRepositoryError"; }
}

function fail(error: RpcError): never {
  const message = error?.message ?? "CERTIFICATION_UNAVAILABLE";
  const known = /CERTIFICATION_[A-Z_]+/.exec(message)?.[0] ?? "CERTIFICATION_UNAVAILABLE";
  throw new CertificationRepositoryError(known);
}
function parseArray<T>(schema: z.ZodType<T>, data: unknown): T[] { return z.array(schema).parse(data); }

export class CertificationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listPublic(slug: string, locale: CertificationLocale): Promise<CertificationListItem[]> {
    const { data, error } = await this.db.rpc("get_public_certifications", { p_slug: slug, p_locale: locale });
    if (error) fail(error); return parseArray(certificationListItemSchema, data);
  }
  async getPublic(id: string, locale: CertificationLocale): Promise<ManualCertification | null> {
    const { data, error } = await this.db.rpc("get_public_certification", { p_id: id, p_locale: locale });
    if (error) fail(error); return data === null ? null : manualCertificationSchema.parse(data);
  }
  async history(appUserId: string, slug: string, locale: CertificationLocale): Promise<CertificationHistoryItem[]> {
    const { data, error } = await this.db.rpc("get_owned_celebrity_certification_history", { p_app_user_id: appUserId, p_slug: slug, p_locale: locale });
    if (error) fail(error); return parseArray(historyItemSchema, data);
  }
  async getSubmission(appUserId: string, id: string, locale: CertificationLocale): Promise<CertificationSubmission | null> {
    const { data, error } = await this.db.rpc("get_owned_certification_submission", { p_app_user_id: appUserId, p_submission_id: id, p_locale: locale });
    if (error) fail(error); return data === null ? null : submissionSchema.parse(data);
  }
  async upload(appUserId: string, missionId: string, normalized: { bytes: Uint8Array; width: number; height: number }): Promise<{ uploadId: string; expiresAt: string }> {
    const uploadId = randomUUID();
    const objectPath = `${appUserId}/${missionId}/${uploadId}.webp`;
    const bucket = this.db.storage.from("certification-proofs");
    const stored = await bucket.upload(objectPath, normalized.bytes, { contentType: "image/webp", cacheControl: "private, max-age=0", upsert: false });
    if (stored.error) throw new CertificationRepositoryError("CERTIFICATION_STORAGE_UNAVAILABLE");
    const sha256 = createHash("sha256").update(normalized.bytes).digest("hex");
    const result = await this.db.rpc("register_owned_certification_upload", {
      p_app_user_id: appUserId, p_mission_id: missionId, p_upload_id: uploadId, p_object_path: objectPath,
      p_byte_size: normalized.bytes.byteLength, p_width: normalized.width, p_height: normalized.height, p_sha256: sha256,
    });
    if (result.error) { await bucket.remove([objectPath]); fail(result.error); }
    return z.object({ uploadId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }) }).parse(result.data);
  }
  async submit(input: { appUserId: string; missionId: string; idempotencyKey: string; uploadIds: string[]; note?: string; previousSubmissionId?: string }): Promise<unknown> {
    const { data, error } = await this.db.rpc("submit_owned_certification", { p_app_user_id: input.appUserId, p_mission_id: input.missionId, p_idempotency_key: input.idempotencyKey, p_upload_ids: input.uploadIds, p_note: input.note ?? null, p_previous_submission_id: input.previousSubmissionId ?? null });
    if (error) fail(error); return commandSchema.parse(data);
  }
  async proofForOwner(appUserId: string, submissionId: string, uploadId: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    const { data: path, error } = await this.db.rpc("get_owned_certification_proof_path", { p_app_user_id: appUserId, p_submission_id: submissionId, p_upload_id: uploadId });
    if (error) fail(error); if (typeof path !== "string") return null;
    return this.download(path);
  }
  async proofForAdmin(actor: { appUserId: string; allowlistId: string }, submissionId: string, uploadId: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    const { data: path, error } = await this.db.rpc("get_admin_certification_proof_path", { p_actor: actor.appUserId, p_allowlist: actor.allowlistId, p_submission_id: submissionId, p_upload_id: uploadId });
    if (error) fail(error); if (typeof path !== "string") return null;
    return this.download(path);
  }
  private async download(path: string) {
    const result = await this.db.storage.from("certification-proofs").download(path);
    if (result.error || !result.data) throw new CertificationRepositoryError("CERTIFICATION_STORAGE_UNAVAILABLE");
    return { bytes: await result.data.arrayBuffer(), contentType: result.data.type || "image/webp" };
  }
  async listAdmin(actor: { appUserId: string; allowlistId: string }): Promise<unknown[]> {
    const { data, error } = await this.db.rpc("get_admin_certification_missions", { p_actor: actor.appUserId, p_allowlist: actor.allowlistId });
    if (error) fail(error); return z.array(z.record(z.string(), z.unknown())).parse(data);
  }
  async saveAdmin(actor: { appUserId: string; allowlistId: string }, correlationId: string, input: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.db.rpc("save_admin_certification_mission_v2", {
      p_actor: actor.appUserId,p_allowlist:actor.allowlistId,p_correlation:correlationId,p_mission_id:input.id ?? null,p_celebrity_id:input.celebrityId,p_immutable_key:input.immutableKey,p_expected_revision:input.expectedRevision ?? null,
      p_category:input.category,p_title_ko:input.titleKo,p_title_en:input.titleEn,p_description_ko:input.descriptionKo,p_description_en:input.descriptionEn,p_instructions_ko:input.instructionsKo,p_instructions_en:input.instructionsEn,p_opens_at:input.opensAt,p_closes_at:input.closesAt,p_score_points:input.scorePoints,p_ticket_amount:input.ticketAmount,p_membership_platform:input.membershipPlatform ?? null,
    }); if (error) fail(error); return data;
  }
  async statusAdmin(actor: { appUserId: string; allowlistId: string }, correlationId: string, input: { id: string; expectedRevision: number; status: "active" | "closed" }): Promise<unknown> {
    const { data, error } = await this.db.rpc("set_admin_certification_mission_status", { p_actor:actor.appUserId,p_allowlist:actor.allowlistId,p_correlation:correlationId,p_mission_id:input.id,p_expected_revision:input.expectedRevision,p_status:input.status });
    if (error) fail(error); return data;
  }
  async queueAdmin(actor: { appUserId: string; allowlistId: string }, status: "pending" | "approved" | "rejected"): Promise<unknown[]> {
    const { data, error } = await this.db.rpc("get_admin_certification_queue", { p_actor:actor.appUserId,p_allowlist:actor.allowlistId,p_status:status });
    if (error) fail(error); return z.array(z.record(z.string(),z.unknown())).parse(data);
  }
  async reviewAdmin(actor: { appUserId: string; allowlistId: string }, correlationId: string, submissionId: string, input: { idem: string; expectedRevision: number; decision: "approve" | "reject"; rejectionReason?: string }): Promise<unknown> {
    const { data, error } = await this.db.rpc("review_admin_certification_submission", { p_actor:actor.appUserId,p_allowlist:actor.allowlistId,p_correlation:correlationId,p_submission_id:submissionId,p_idempotency_key:input.idem,p_expected_revision:input.expectedRevision,p_decision:input.decision,p_rejection_reason:input.rejectionReason ?? null });
    if (error) fail(error); return data;
  }
}

export function createCertificationRepository(source: Record<string,string|undefined> = process.env): CertificationRepository {
  if (!source.SUPABASE_URL || !source.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Certification repository is not configured");
  return new CertificationRepository(createClient(source.SUPABASE_URL,source.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
}
