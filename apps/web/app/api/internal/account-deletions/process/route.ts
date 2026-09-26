import { timingSafeEqual } from "node:crypto";
import { createAccountDeletionDependencies } from "@/server/profile/account-deletion-dependencies";
import { processAccountDeletion, processContentAssetCleanup } from "@/server/profile/account-deletion";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const headers = { "cache-control": "no-store" };
  if (!secret || secret.length < 32 || authorization.length !== expected.length || !timingSafeEqual(authorization, expected))
    return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401, headers });
  try {
    const deps = createAccountDeletionDependencies();
    const removedAssets = await processContentAssetCleanup(deps);
    let completed = 0; let pending = 0;
    for (let index = 0; index < 3; index++) {
      const result = await processAccountDeletion(deps);
      if (result === "idle") break;
      if (result === "completed") completed++; else pending++;
    }
    return Response.json({ completed, pending, removedAssets }, { headers });
  } catch { return Response.json({ error: { code: "ACCOUNT_CLEANUP_UNAVAILABLE" } }, { status: 503, headers }); }
}
