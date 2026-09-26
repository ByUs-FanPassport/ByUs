import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("schedule", request, await context.params); }
