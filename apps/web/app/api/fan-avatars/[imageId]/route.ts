import { createSupabaseAvatarRepository } from "@/server/avatar/avatar-repository";
import { createPublicAvatarImageHandler, publicAvatarFailure } from "@/server/avatar/public-avatar-route";
import { loadServerEnv } from "@/server/config/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ imageId: string }> }) {
  try {
    const { imageId } = await context.params;
    const environment = loadServerEnv();
    const repository = createSupabaseAvatarRepository({
      url: environment.SUPABASE_URL,
      serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    });
    return await createPublicAvatarImageHandler(repository)(request, imageId);
  } catch {
    return publicAvatarFailure(503);
  }
}
