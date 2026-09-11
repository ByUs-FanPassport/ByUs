import { supportHandlers } from "@/server/support/dependencies";
import { supportFailure } from "@/server/support/routes";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return await supportHandlers().list(request); } catch (error) { return supportFailure(error); }
}
export async function POST(request: Request) {
  try { return await supportHandlers().create(request); } catch (error) { return supportFailure(error); }
}
