import { banksyPublicHandlers } from "@/server/analytics/banksy-dependencies";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return banksyPublicHandlers().visit(request); }
