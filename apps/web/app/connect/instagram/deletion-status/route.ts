import { createInstagramDependencies } from "../../../../server/instagram/dependencies";
import { createInstagramDeletionStatusHandler } from "../../../../server/instagram/routes";
import { unavailablePage } from "../../../../server/instagram/pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(request: Request) {
  try { return await createInstagramDeletionStatusHandler(createInstagramDependencies({ allowDisabled: true }))(request); }
  catch { return unavailablePage(); }
}
export const GET = handle;
