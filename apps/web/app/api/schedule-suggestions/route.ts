import { participationRoute } from "@/server/schedules/routes";
export async function GET(request: Request) { return participationRoute("suggestions", request); }
export async function POST(request: Request) { return participationRoute("suggestions", request); }
