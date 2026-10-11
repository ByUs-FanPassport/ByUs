import "server-only";

import { z } from "zod";
import type { PublicAvatarRepository } from "./avatar-repository";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function publicAvatarFailure(status: number): Response {
  return new Response(null, { status, headers });
}

export function createPublicAvatarImageHandler(repository: PublicAvatarRepository) {
  return async (request: Request, imageId: string): Promise<Response> => {
    const revisions = new URL(request.url).searchParams.getAll("revision");
    if (!z.uuid().safeParse(imageId).success || revisions.length !== 1 ||
        !/^(0|[1-9][0-9]{0,9})$/.test(revisions[0]) || Number(revisions[0]) > 2147483647) {
      return publicAvatarFailure(404);
    }
    try {
      const image = await repository.publicImage(imageId, Number(revisions[0]));
      return image ? new Response(image.bytes, {
        headers: { ...headers, "content-type": "image/webp" },
      }) : publicAvatarFailure(404);
    } catch {
      return publicAvatarFailure(503);
    }
  };
}
