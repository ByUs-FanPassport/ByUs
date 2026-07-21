import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { ContentLocale } from "../content/content-domain";
import {
  parsePublicQuizIntro,
  type PublicQuizIntro,
} from "../../features/quiz/domain/quiz-intro";

export interface PublicQuizIntroRepository {
  findBySlug(input: {
    slug: string;
    locale: ContentLocale;
  }): Promise<PublicQuizIntro | null>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export class SupabasePublicQuizIntroRepository
  implements PublicQuizIntroRepository
{
  constructor(private readonly client: RpcClient) {}

  async findBySlug(input: {
    slug: string;
    locale: ContentLocale;
  }): Promise<PublicQuizIntro | null> {
    const { data, error } = await this.client.rpc("get_published_quiz_intro", {
      p_slug: input.slug,
      p_locale: input.locale,
    });
    if (error) throw new Error("Public quiz intro query failed");
    if (data === null) return null;

    try {
      return parsePublicQuizIntro(data);
    } catch {
      throw new Error("Public quiz intro projection is invalid");
    }
  }
}

export function createPublicQuizIntroRepositoryFromEnvironment(
  source: Record<string, string | undefined> = process.env,
): PublicQuizIntroRepository {
  const url = source.SUPABASE_URL;
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Public quiz intro repository is not configured");
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabasePublicQuizIntroRepository(client as unknown as RpcClient);
}
