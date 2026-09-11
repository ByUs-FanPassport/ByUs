import { createAdminDirectoryRouteDependencies } from "../../../../server/admin/admin-directory-route-dependencies";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return createAdminDirectoryRouteDependencies().GET(request); }
export async function POST(request: Request) { return createAdminDirectoryRouteDependencies().POST(request); }
export async function PATCH(request: Request) { return createAdminDirectoryRouteDependencies().PATCH(request); }
