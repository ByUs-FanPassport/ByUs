import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  buildLiveCalendarMonth,
  getLiveCalendarUtcBounds,
  type LiveCalendarMonth,
} from "../../features/live/domain/live-calendar";
import type { LiveLocale } from "../../features/live/domain/live-event";
import { SupabaseCalendarCreatorImageLookup, type CalendarCreatorImageClient, type CalendarCreatorImageLookup } from "../media/calendar-creator-images";
import { createPublicImageRoleReader, type PublicImageRoleReader } from "../media/public-image-reader";

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

export class PublicImageLiveCalendarRepository implements LiveCalendarRepository {
  constructor(
    private readonly repository: LiveCalendarRepository,
    private readonly images: PublicImageRoleReader,
    private readonly creators: CalendarCreatorImageLookup,
  ) {}

  async readMonth(input: {
    month: string;
    locale: LiveLocale;
    appUserId: string | null;
    now: Date;
  }): Promise<LiveCalendarMonth> {
    const calendar = await this.repository.readMonth(input);
    const slugs = calendar.days.flatMap(({ events }) =>
      events.map(({ slug }) => slug),
    );
    const [photosBySlug, creatorsByLiveSlug] = await Promise.all([
      this.images.readLivePhotoSetsBySlug(slugs),
      this.creators.readByLiveSlugs(slugs),
    ]);
    const creatorPhotosBySlug = await this.images.readCelebrityPhotoSetsBySlug(
      Object.values(creatorsByLiveSlug).map(({ celebritySlug }) => celebritySlug),
    );
    return {
      ...calendar,
      days: calendar.days.map((day) => ({
        ...day,
        events: day.events.map((event) => {
          const photos = photosBySlug[event.slug];
          const creator = creatorsByLiveSlug[event.slug];
          if (photos === undefined && creator === undefined) return event;
          return {
            ...event,
            ...(photos === undefined ? {} : { photos }),
            celebrity: {
              ...event.celebrity,
              ...(creator === undefined ? {} : {
                imagePosition: creator.imagePosition,
                ...(creatorPhotosBySlug[creator.celebritySlug] === undefined ? {} : { photos: creatorPhotosBySlug[creator.celebritySlug] }),
              }),
            },
          };
        }),
      })),
    };
  }
}

export function createLiveCalendarRepositoryFromEnvironment(config: {
  url: string;
  serviceRoleKey: string;
}, client?: RpcClient): LiveCalendarRepository {
  const database = client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new PublicImageLiveCalendarRepository(
    new SupabaseLiveCalendarRepository(database as unknown as RpcClient),
    createPublicImageRoleReader(config, database as unknown as SupabaseClient),
    new SupabaseCalendarCreatorImageLookup(database as unknown as CalendarCreatorImageClient),
  );
}
