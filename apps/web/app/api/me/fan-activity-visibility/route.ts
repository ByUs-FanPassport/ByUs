import { fanpageJson } from "@/server/fanpage/routes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  return fanpageJson({ error: { code: "FAN_ACTIVITY_VISIBILITY_RETIRED" } }, 410);
}
export const PATCH = GET;
