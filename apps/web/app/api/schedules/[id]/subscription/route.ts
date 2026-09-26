import { participationRoute } from "@/server/schedules/routes";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("subscription", request, await context.params); }
