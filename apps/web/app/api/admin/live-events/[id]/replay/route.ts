import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("admin-replay", request, await context.params); }
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("admin-replay", request, await context.params); }
