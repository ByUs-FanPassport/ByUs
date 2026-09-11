import { fanpageJson } from "@/server/fanpage/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT() {
  return fanpageJson({ error: { code: "LOUNGE_NOT_AVAILABLE" } }, 404);
}
