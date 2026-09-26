import { createAccountDeletionDependencies } from "@/server/profile/account-deletion-dependencies";
import { createDeleteAccountHandler } from "@/server/profile/account-deletion";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function DELETE(request: Request) {
  try { return await createDeleteAccountHandler(createAccountDeletionDependencies())(request); }
  catch { return Response.json({ error: { code: "ACCOUNT_DELETION_UNAVAILABLE" } }, { status: 503, headers: { "cache-control": "private, no-store", vary: "Authorization" } }); }
}
