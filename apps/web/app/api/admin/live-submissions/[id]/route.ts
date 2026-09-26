import { participationRoute } from "@/server/schedules/routes";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("admin-live-submission", request, await context.params); }
