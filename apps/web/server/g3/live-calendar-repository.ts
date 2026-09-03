import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  buildLiveCalendarMonth,
  getLiveCalendarUtcBounds,
  type LiveCalendarMonth,
} from "../../features/live/domain/live-calendar";
import type { LiveLocale } from "../../features/live/domain/live-event";

export interface LiveCalendarRepository {
  readMonth(input: {
    month: string;
    locale: LiveLocale;
    appUserId: string | null;
    now: Date;
  }): Promise<LiveCalendarMonth>;
}

interface RpcClient {
  rpc(
    name: string,
    parameters: Record<string, string | null>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const publicCalendarEventKeys = new Set([
  "id",
  "slug",
  "startsAt",
  "effectiveStatus",
  "title",
  "celebrity",
  "reservationState",
  "hasBenefit",
]);

const publicCelebrityKeys = new Set(["name", "image"]);

function hasExactKeys(value: unknown, allowed: ReadonlySet<string>): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key));
}

function assertSafeRows(data: unknown, appUserId: string | null): asserts data is Array<Record<string, unknown>> {
  if (!Array.isArray(data)) throw new Error("LIVE calendar projection is invalid");

  for (const row of data) {
    if (!hasExactKeys(row, publicCalendarEventKeys)
      || !hasExactKeys(row.celebrity, publicCelebrityKeys)) {
      throw new Error("LIVE calendar projection is invalid");
    }
    if (appUserId === null && row.reservationState !== null) {
      throw new Error("LIVE calendar projection is invalid");
    }
    if (appUserId !== null
      && row.reservationState !== "reserved"
      && row.reservationState !== "not_reserved") {
      throw new Error("LIVE calendar projection is invalid");
    }
  }
}

export class SupabaseLiveCalendarRepository implements LiveCalendarRepository {
  constructor(private readonly client: RpcClient) {}

  async readMonth(input: {
    month: string;
    locale: LiveLocale;
    appUserId: string | null;
    now: Date;
  }): Promise<LiveCalendarMonth> {
    const bounds = getLiveCalendarUtcBounds(input.month);
    const { data, error } = await this.client.rpc("get_live_calendar_month", {
      p_app_user_id: input.appUserId,
      p_locale: input.locale,
      p_starts_at: bounds.startsAt,
      p_ends_at: bounds.endsAt,
      p_now: input.now.toISOString(),
    });
    if (error) throw new Error("LIVE calendar lookup failed");

    const rows = data ?? [];
    assertSafeRows(rows, input.appUserId);
    try {
      return buildLiveCalendarMonth({ month: input.month, events: rows });
    } catch {
      throw new Error("LIVE calendar projection is invalid");
    }
  }
}

export function createLiveCalendarRepositoryFromEnvironment(config: {
  url: string;
  serviceRoleKey: string;
}): LiveCalendarRepository {
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabaseLiveCalendarRepository(client as unknown as RpcClient);
}
