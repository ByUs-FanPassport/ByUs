import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  fanProfileSchema,
  type FanProfile,
} from "../../features/profile/domain/profile";

export type ProfileRepositoryFailureCode =
  | "INVALID_NICKNAME"
  | "NICKNAME_PROHIBITED"
  | "NICKNAME_TAKEN"
  | "PROFILE_ALREADY_COMPLETED"
  | "USER_UNAVAILABLE"
  | "PROFILE_INTEGRITY_ERROR";

export class ProfileRepositoryError extends Error {
  constructor(readonly code: ProfileRepositoryFailureCode) {
    super(code);
    this.name = "ProfileRepositoryError";
  }
}

export interface ProfileRepository {
  get(appUserId: string): Promise<FanProfile>;
  setNickname(input: {
    appUserId: string;
    nickname: string;
  }): Promise<FanProfile>;
  renameNickname?(input: {
    appUserId: string;
    nickname: string;
  }): Promise<FanProfile>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

const markers: Readonly<Record<string, ProfileRepositoryFailureCode>> = {
  FAN005_INVALID_NICKNAME: "INVALID_NICKNAME",
  FAN005_NICKNAME_PROHIBITED: "NICKNAME_PROHIBITED",
  FAN005_NICKNAME_TAKEN: "NICKNAME_TAKEN",
  FAN005_PROFILE_ALREADY_COMPLETED: "PROFILE_ALREADY_COMPLETED",
  FAN005_USER_UNAVAILABLE: "USER_UNAVAILABLE",
};

function repositoryError(error: { message?: string }): ProfileRepositoryError {
  const marker = Object.keys(markers).find((candidate) =>
    error.message?.includes(candidate),
  );
  return new ProfileRepositoryError(
    marker ? markers[marker] : "PROFILE_INTEGRITY_ERROR",
  );
}

function project(data: unknown): FanProfile {
  const parsed = fanProfileSchema.safeParse(data);
  if (!parsed.success)
    throw new ProfileRepositoryError("PROFILE_INTEGRITY_ERROR");
  return parsed.data;
}

export class SupabaseProfileRepository implements ProfileRepository {
  constructor(private readonly client: RpcClient) {}

  async get(appUserId: string): Promise<FanProfile> {
    const { data, error } = await this.client.rpc("get_owned_user_profile", {
      p_app_user_id: appUserId,
    });
    if (error) throw repositoryError(error);
    return project(data);
  }

  async setNickname(input: {
    appUserId: string;
    nickname: string;
  }): Promise<FanProfile> {
    const { data, error } = await this.client.rpc("set_owned_user_nickname", {
      p_app_user_id: input.appUserId,
      p_nickname: input.nickname,
    });
    if (error) throw repositoryError(error);
    return project(data);
  }

  async renameNickname(input: {
    appUserId: string;
    nickname: string;
  }): Promise<FanProfile> {
    const { data, error } = await this.client.rpc(
      "rename_owned_user_nickname",
      {
        p_app_user_id: input.appUserId,
        p_nickname: input.nickname,
      },
    );
    if (error) throw repositoryError(error);
    return project(data);
  }
}

export function createSupabaseProfileRepository(config: {
  url: string;
  serviceRoleKey: string;
}): ProfileRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return new SupabaseProfileRepository(client as unknown as RpcClient);
}
