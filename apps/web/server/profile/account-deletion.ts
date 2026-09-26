import "server-only";
import { z } from "zod";
import { AuthError } from "@/features/auth/domain/auth-errors";

const objectSchema = z.object({ id: z.uuid(), bucket: z.enum(["fan-avatars", "certification-proofs"]), path: z.string().min(1).max(500), generation: z.number().int().nonnegative() }).strict();
const claimSchema = z.object({ appUserId: z.uuid(), leaseToken: z.uuid(), providerSubject: z.string().nullable(), objects: z.array(objectSchema).max(100) }).strict();
const deletionSchema = z.object({ appUserId: z.uuid().nullable(), status: z.enum(["pending", "completed"]) }).strict();
const contentCleanupSchema = z.object({ items: z.array(z.object({ id: z.uuid(), bucket: z.literal("fan-content-assets"), storagePath: z.string().min(1).max(500), generation: z.number().int().nonnegative() })).max(50) });
export interface AccountDeletionDependencies {
  verifySubject(authorization: string | null): Promise<string>;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  removeObject(bucket: string, path: string): Promise<void>;
  deleteProviderUser(subject: string): Promise<void>;
}
const headers = { "cache-control": "private, no-store", vary: "Authorization" };

// The A queue also covers expired and late uploads unrelated to pending accounts.
export async function processContentAssetCleanup(deps: AccountDeletionDependencies) {
  const { items } = contentCleanupSchema.parse(await deps.rpc("claim_content_asset_cleanup", { p_limit: 50 }));
  let removed = 0;
  for (const item of items) {
    let succeeded = false;
    try { await deps.removeObject(item.bucket, item.storagePath); succeeded = true; }
    catch { /* The durable queue owns retries; never log private paths/provider bodies. */ }
    await deps.rpc("finish_content_asset_cleanup", { p_asset_id: item.id, p_generation: item.generation, p_succeeded: succeeded });
    if (succeeded) removed++;
  }
  return removed;
}

export async function processAccountDeletion(deps: AccountDeletionDependencies, appUserId: string | null = null): Promise<"idle" | "pending" | "completed"> {
  const job = claimSchema.nullable().parse(await deps.rpc("claim_account_deletion", { p_app_user_id: appUserId }));
  if (!job) return "idle";
  let failure = "STORAGE_UNAVAILABLE";
  try {
    for (const object of job.objects) {
      await deps.removeObject(object.bucket, object.path);
      await deps.rpc("finish_account_deletion_object", { p_app_user_id: job.appUserId, p_lease_token: job.leaseToken, p_object_id: object.id, p_generation: object.generation });
    }
    const ready = await deps.rpc("account_deletion_storage_ready", { p_app_user_id: job.appUserId, p_lease_token: job.leaseToken });
    if (ready !== true) {
      await deps.rpc("retry_account_deletion", { p_app_user_id: job.appUserId, p_lease_token: job.leaseToken, p_error_code: "CLEANUP_PENDING" });
      return "pending";
    }
    failure = "PROVIDER_UNAVAILABLE";
    if (job.providerSubject) await deps.deleteProviderUser(job.providerSubject);
    failure = "FINALIZATION_UNAVAILABLE";
    const completed = await deps.rpc("complete_account_deletion", { p_app_user_id: job.appUserId, p_lease_token: job.leaseToken });
    if (completed !== true) throw new Error("Account cleanup is pending");
    return "completed";
  } catch {
    await deps.rpc("retry_account_deletion", { p_app_user_id: job.appUserId, p_lease_token: job.leaseToken, p_error_code: failure });
    return "pending";
  }
}

async function confirmation(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new z.ZodError([]);
  const reader = request.body?.getReader();
  if (!reader) throw new z.ZodError([]);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new z.ZodError([]); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  z.object({ confirmation: z.literal("DELETE") }).strict().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

export function createDeleteAccountHandler(deps: AccountDeletionDependencies) {
  return async (request: Request) => {
    try {
      const subject = await deps.verifySubject(request.headers.get("authorization"));
      try { await confirmation(request); } catch {
        return Response.json({ error: { code: "DELETION_CONFIRMATION_REQUIRED" } }, { status: 400, headers });
      }
      const deletion = deletionSchema.parse(await deps.rpc("begin_owned_account_deletion", { p_privy_user_id: subject }));
      let status = deletion.status;
      if (status === "pending" && deletion.appUserId) {
        // Accepted deletion remains pending if a transient cleanup dependency fails.
        try {
          await processContentAssetCleanup(deps);
          if (await processAccountDeletion(deps, deletion.appUserId) === "completed") status = "completed";
        } catch { /* Cron resumes the durable request. */ }
      }
      return Response.json({ deletion: { status } }, { status: status === "completed" ? 200 : 202, headers });
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 503;
      return Response.json({ error: { code: error instanceof AuthError ? error.code : "ACCOUNT_DELETION_UNAVAILABLE" } }, { status, headers });
    }
  };
}
