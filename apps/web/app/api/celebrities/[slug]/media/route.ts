import { officialMediaRoute } from "@/server/media/official-media-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) { return officialMediaRoute(request, (await params).slug); }
