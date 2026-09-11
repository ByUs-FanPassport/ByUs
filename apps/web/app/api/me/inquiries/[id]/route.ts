import { supportHandlers } from "@/server/support/dependencies";
import { supportFailure } from "@/server/support/routes";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await supportHandlers().detail(request, (await context.params).id); } catch (error) { return supportFailure(error); }
}
