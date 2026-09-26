import { participationRoute } from "@/server/schedules/routes";
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return participationRoute("live-submission", request, await context.params); }
