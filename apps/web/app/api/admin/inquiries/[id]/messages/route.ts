import { supportHandlers } from "@/server/support/dependencies";
import { supportFailure } from "@/server/support/routes";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return await supportHandlers().post(request, (await context.params).id, true); } catch (error) { return supportFailure(error); }
}
