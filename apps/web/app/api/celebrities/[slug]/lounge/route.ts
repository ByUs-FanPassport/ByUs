import { fanpageJson } from "@/server/fanpage/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pause conversations without deleting records or removing owner/admin controls.
export async function GET() {
  return fanpageJson({ error: { code: "LOUNGE_NOT_AVAILABLE" } }, 404);
}
export const POST = GET;
