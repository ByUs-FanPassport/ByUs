import { supportHandlers } from "@/server/support/dependencies";
import { supportFailure } from "@/server/support/routes";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await supportHandlers().list(request, true); } catch (error) { return supportFailure(error); }
}
