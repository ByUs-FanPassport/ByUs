import {
  createLiveAttendanceRouteDependencies,
  liveAttendanceUnavailableResponse,
} from "../../../../../server/g3/live-attendance-route-dependencies";
import { createPostLiveAttendanceHandler } from "../../../../../server/g3/live-attendance-route";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const dependencies = createLiveAttendanceRouteDependencies();
    const { slug } = await context.params;
    return createPostLiveAttendanceHandler(dependencies)(request, { slug });
  } catch {
    return liveAttendanceUnavailableResponse();
  }
}
