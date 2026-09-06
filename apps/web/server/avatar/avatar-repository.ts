import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  avatarCharacterIdSchema,
  avatarSchema,
  avatarSourceSchema,
  type Avatar,
  type AvatarCharacterId,
} from "../../features/profile/domain/avatar";

const AVATAR_BUCKET = "fan-avatars";

const persistedAvatarSchema = avatarSchema.extend({
  objectPath: z.string().nullable(),
  previousObjectPath: z.string().nullable(),
});

type PersistedAvatar = z.infer<typeof persistedAvatarSchema>;

export type AvatarRepositoryFailureCode =
  | "STALE_REVISION"
  | "USER_UNAVAILABLE"
  | "INVALID_CHARACTER"
  | "STORAGE_UNAVAILABLE"
  | "AVATAR_UNAVAILABLE";

export class AvatarRepositoryError extends Error {
  constructor(readonly code: AvatarRepositoryFailureCode) {
    super(code);
    this.name = "AvatarRepositoryError";
  }
}

export interface AvatarImageDownload {
  bytes: ArrayBuffer;
  contentType: string;
}

export interface AvatarRepository {
  ensure(appUserId: string): Promise<Avatar>;
  selectCharacter(input: {
    appUserId: string;
    characterId: AvatarCharacterId;
    expectedRevision: number;
  }): Promise<Avatar>;
  replaceImage(input: {
    appUserId: string;
    source: "google" | "upload";
    expectedRevision: number;
    bytes: Uint8Array;
  }): Promise<Avatar>;
  remove(input: { appUserId: string; expectedRevision: number }): Promise<Avatar>;
  image(appUserId: string, expectedRevision: number): Promise<AvatarImageDownload | null>;
}

interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

interface AvatarClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<RpcResult>;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean; cacheControl: string },
      ): PromiseLike<{ error: { message?: string } | null }>;
      remove(paths: string[]): PromiseLike<{ error: { message?: string } | null }>;
      download(path: string): PromiseLike<{
        data: Blob | null;
        error: { message?: string } | null;
      }>;
    };
  };
}

function mapRpcError(error: { message?: string }): AvatarRepositoryError {
  const message = error.message ?? "";
  if (message.includes("AVATAR_STALE_REVISION")) {
    return new AvatarRepositoryError("STALE_REVISION");
  }
  if (message.includes("AVATAR_USER_UNAVAILABLE")) {
    return new AvatarRepositoryError("USER_UNAVAILABLE");
  }
  if (message.includes("AVATAR_INVALID_CHARACTER")) {
    return new AvatarRepositoryError("INVALID_CHARACTER");
  }
  return new AvatarRepositoryError("AVATAR_UNAVAILABLE");
}

function parsePersisted(data: unknown): PersistedAvatar {
  const parsed = persistedAvatarSchema.safeParse(data);
  if (!parsed.success) throw new AvatarRepositoryError("AVATAR_UNAVAILABLE");
  return parsed.data;
}

function publicAvatar(avatar: PersistedAvatar): Avatar {
  return avatarSchema.parse({
    initialCharacterId: avatar.initialCharacterId,
    characterId: avatar.characterId,
    source: avatar.source,
    hasImage: avatar.hasImage,
    revision: avatar.revision,
  });
}

export class SupabaseAvatarRepository implements AvatarRepository {
  constructor(
    private readonly client: AvatarClient,
    private readonly createId: () => string = randomUUID,
  ) {}

  async ensure(appUserId: string): Promise<Avatar> {
    const { data, error } = await this.client.rpc("ensure_owned_avatar", {
      p_app_user_id: appUserId,
    });
    if (error) throw mapRpcError(error);
    return publicAvatar(parsePersisted(data));
  }

  async selectCharacter(input: {
    appUserId: string;
    characterId: AvatarCharacterId;
    expectedRevision: number;
  }): Promise<Avatar> {
    const characterId = avatarCharacterIdSchema.parse(input.characterId);
    const persisted = await this.mutate("set_owned_avatar_character", {
      p_app_user_id: input.appUserId,
      p_character_id: characterId,
      p_expected_revision: input.expectedRevision,
    });
    await this.removePrevious(persisted.previousObjectPath);
    return publicAvatar(persisted);
  }

  async replaceImage(input: {
    appUserId: string;
    source: "google" | "upload";
    expectedRevision: number;
    bytes: Uint8Array;
  }): Promise<Avatar> {
    const source = avatarSourceSchema.extract(["google", "upload"]).parse(input.source);
    const objectPath = `${input.appUserId}/${input.expectedRevision + 1}-${this.createId()}.webp`;
    const bucket = this.client.storage.from(AVATAR_BUCKET);
    const upload = await bucket.upload(objectPath, input.bytes, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "31536000",
    });
    if (upload.error) throw new AvatarRepositoryError("STORAGE_UNAVAILABLE");

    const mutation = await this.client.rpc("set_owned_avatar_image", {
      p_app_user_id: input.appUserId,
      p_source: source,
      p_object_path: objectPath,
      p_expected_revision: input.expectedRevision,
    });
    if (mutation.error?.message?.includes("AVATAR_STALE_REVISION")) {
      try {
        await bucket.remove([objectPath]);
      } catch {
        // CAS is definitively rejected even if candidate cleanup must be retried.
      }
      throw new AvatarRepositoryError("STALE_REVISION");
    }

    let persisted: PersistedAvatar;
    try {
      if (mutation.error) throw mapRpcError(mutation.error);
      persisted = parsePersisted(mutation.data);
    } catch (error) {
      // A transport failure or malformed response can arrive after the database
      // committed. Re-read authoritative state before deciding whether this
      // immutable candidate is safe to delete.
      const reconciled = await this.reconcileCandidate(
        input.appUserId,
        objectPath,
        input.expectedRevision,
      );
      if (reconciled) return publicAvatar(reconciled);
      throw error;
    }

    await this.removePrevious(persisted.previousObjectPath);
    return publicAvatar(persisted);
  }

  async remove(input: {
    appUserId: string;
    expectedRevision: number;
  }): Promise<Avatar> {
    const persisted = await this.mutate("remove_owned_avatar", {
      p_app_user_id: input.appUserId,
      p_expected_revision: input.expectedRevision,
    });
    await this.removePrevious(persisted.previousObjectPath);
    return publicAvatar(persisted);
  }

  async image(
    appUserId: string,
    expectedRevision: number,
  ): Promise<AvatarImageDownload | null> {
    const { data, error } = await this.client.rpc("ensure_owned_avatar", {
      p_app_user_id: appUserId,
    });
    if (error) throw mapRpcError(error);
    const persisted = parsePersisted(data);
    if (persisted.revision !== expectedRevision) {
      throw new AvatarRepositoryError("STALE_REVISION");
    }
    if (!persisted.objectPath) return null;
    const result = await this.client.storage.from(AVATAR_BUCKET).download(persisted.objectPath);
    if (result.error || !result.data) {
      throw new AvatarRepositoryError("STORAGE_UNAVAILABLE");
    }
    return {
      bytes: await result.data.arrayBuffer(),
      contentType: result.data.type || "image/webp",
    };
  }

  private async mutate(
    name: string,
    parameters: Record<string, unknown>,
  ): Promise<PersistedAvatar> {
    const { data, error } = await this.client.rpc(name, parameters);
    if (error) throw mapRpcError(error);
    return parsePersisted(data);
  }

  private async removePrevious(path: string | null): Promise<void> {
    if (!path) return;
    // The database mutation is already committed. A storage cleanup failure must
    // not make the client retry the committed CAS operation.
    try {
      await this.client.storage.from(AVATAR_BUCKET).remove([path]);
    } catch {
      // Keep the committed avatar response successful. Object paths contain no
      // credentials, and orphan cleanup can be retried out of band.
    }
  }

  private async reconcileCandidate(
    appUserId: string,
    candidatePath: string,
    expectedRevision: number,
  ): Promise<PersistedAvatar | null> {
    try {
      const { data, error } = await this.client.rpc("ensure_owned_avatar", {
        p_app_user_id: appUserId,
      });
      if (error) return null;
      const current = parsePersisted(data);
      if (current.objectPath === candidatePath) return current;
      if (current.revision > expectedRevision) {
        await this.client.storage.from(AVATAR_BUCKET).remove([candidatePath]);
      }
      return null;
    } catch {
      // Preserve the candidate when commit state cannot be established. A later
      // reconciler may remove an orphan; deleting a referenced avatar is worse.
      return null;
    }
  }
}

export function createSupabaseAvatarRepository(
  config: { url: string; serviceRoleKey: string },
  existingClient?: AvatarClient,
): AvatarRepository {
  const client =
    existingClient ??
    (createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as AvatarClient);
  return new SupabaseAvatarRepository(client);
}
