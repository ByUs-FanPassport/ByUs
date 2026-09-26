import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) { return participationRoute("live-submissions", request, await context.params); }
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) { return participationRoute("live-submissions", request, await context.params); }
