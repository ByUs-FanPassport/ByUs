import { createRecurringLiveHandlers } from "@/server/g5/recurring-live-route";
import { createRecurringLiveRouteDependencies } from "@/server/g5/recurring-live-route-dependencies";
const handlers = () => createRecurringLiveHandlers(createRecurringLiveRouteDependencies());
export async function GET(request: Request) { return handlers().GET(request); }
export async function POST(request: Request) { return handlers().POST(request); }
