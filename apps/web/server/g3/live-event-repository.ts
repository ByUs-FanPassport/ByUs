import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  deriveEffectiveLiveStatus,
  deriveLivePrimaryAction,
  liveEventResponseSchema,
  parseExactYouTubeUrl,
  type EffectiveLiveStatus,
  type LiveEventResponse,
  type LiveLocale,
  type LiveReservationSummary,
  type LiveStatusOverride,
  type LiveViewer,
} from "../../features/live/domain/live-event";

export interface LiveEventRepository {
  findPublishedBySlug(input: {
    slug: string;
    locale: LiveLocale;
    appUserId: string | null;
    now: Date;
  }): Promise<LiveEventResponse | null>;
}

export interface LiveEventRecord {
  id: string;
  slug: string;
  sourceStatus: EffectiveLiveStatus;
  startsAt: string;
  endsAt: string;
  reservationOpensAt: string;
  reservationClosesAt: string;
  youtubeUrl: string;
  heroUrl: string;
  title: string;
  description: string;
  heroAlt: string;
  celebrity: { id: string; slug: string; name: string; image: string };
  brand: {
    slug: string;
    name: string;
    logo: string;
    websiteUrl: string | null;
    productContext: string;
  };
  overrides: readonly LiveStatusOverride[];
}

export interface LiveViewerRecord {
  hasPassport: boolean;
  reservation: LiveReservationSummary | null;
}

export interface LiveEventDataSource {
  findPublishedEvent(slug: string, locale: LiveLocale): Promise<LiveEventRecord | null>;
  findViewer(appUserId: string, event: LiveEventRecord): Promise<LiveViewerRecord>;
}

export class DefaultLiveEventRepository implements LiveEventRepository {
  constructor(private readonly source: LiveEventDataSource) {}

  async findPublishedBySlug(input: {
    slug: string;
    locale: LiveLocale;
    appUserId: string | null;
    now: Date;
  }): Promise<LiveEventResponse | null> {
    const record = await this.source.findPublishedEvent(input.slug, input.locale);
    if (!record) return null;

    const owner = input.appUserId
      ? await this.source.findViewer(input.appUserId, record)
      : { hasPassport: false, reservation: null };
    const viewer: LiveViewer = {
      authenticated: input.appUserId !== null,
      passport: owner.hasPassport ? "active" : "missing",
      reservation: owner.reservation,
    };
    const effectiveStatus = deriveEffectiveLiveStatus({
      sourceStatus: record.sourceStatus,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      overrides: record.overrides,
      now: input.now,
    });
    const watchUrl = parseExactYouTubeUrl(record.youtubeUrl);
    const response: LiveEventResponse = {
      live: {
        id: record.id,
        slug: record.slug,
        effectiveStatus,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
        reservationOpensAt: record.reservationOpensAt,
        reservationClosesAt: record.reservationClosesAt,
        title: record.title,
        description: record.description,
        productContext: record.brand.productContext,
        heroImage: { url: record.heroUrl, alt: record.heroAlt },
        celebrity: {
          slug: record.celebrity.slug,
          name: record.celebrity.name,
          image: record.celebrity.image,
        },
        brand: {
          slug: record.brand.slug,
          name: record.brand.name,
          logo: record.brand.logo,
          websiteUrl: record.brand.websiteUrl,
        },
        watch: { available: effectiveStatus === "live", url: watchUrl },
      },
      viewer,
      primaryAction: deriveLivePrimaryAction({
        status: effectiveStatus,
        reservationOpensAt: record.reservationOpensAt,
        reservationClosesAt: record.reservationClosesAt,
        now: input.now,
        viewer,
      }),
    };
    return liveEventResponseSchema.parse(response);
  }
}

type DatabaseClient = Pick<SupabaseClient, "from">;

function onlyRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

class SupabaseLiveEventDataSource implements LiveEventDataSource {
  constructor(private readonly database: DatabaseClient) {}

  async findPublishedEvent(slug: string, locale: LiveLocale): Promise<LiveEventRecord | null> {
    const { data: event, error: eventError } = await this.database
      .from("live_events")
      .select("id, slug, celebrity_id, brand_id, content_status, starts_at, ends_at, reservation_opens_at, reservation_closes_at, youtube_url, approved_hero_url")
      .eq("slug", slug)
      .eq("publication_status", "published")
      .maybeSingle();
    if (eventError) throw new Error("Published live event lookup failed");
    if (!event) return null;

    const [localizationResult, celebrityResult, brandResult, overridesResult] = await Promise.all([
      this.database.from("live_event_localizations").select("title, summary, hero_alt").eq("live_event_id", event.id).eq("locale", locale).maybeSingle(),
      this.database.from("celebrities").select("id, slug, image_url, celebrity_localizations!inner(name)").eq("id", event.celebrity_id).eq("status", "published").eq("celebrity_localizations.locale", locale).maybeSingle(),
      this.database.from("brands").select("slug, logo_url, website_url, brand_localizations!inner(name, description)").eq("id", event.brand_id).eq("status", "published").eq("brand_localizations.locale", locale).maybeSingle(),
      this.database.from("live_status_overrides").select("effective_status, effective_from, effective_until, created_at").eq("live_event_id", event.id),
    ]);
    if (localizationResult.error || celebrityResult.error || brandResult.error || overridesResult.error) {
      throw new Error("Published live event projection failed");
    }
    const localization = localizationResult.data;
    const celebrity = celebrityResult.data;
    const brand = brandResult.data;
    const celebrityLocalization = onlyRow(celebrity?.celebrity_localizations ?? null);
    const brandLocalization = onlyRow(brand?.brand_localizations ?? null);
    if (!localization || !celebrity || !brand || !celebrityLocalization || !brandLocalization) {
      throw new Error("Published live event projection is incomplete");
    }

    return {
      id: event.id,
      slug: event.slug,
      sourceStatus: event.content_status,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      reservationOpensAt: event.reservation_opens_at,
      reservationClosesAt: event.reservation_closes_at,
      youtubeUrl: event.youtube_url,
      heroUrl: event.approved_hero_url,
      title: localization.title,
      description: localization.summary,
      heroAlt: localization.hero_alt,
      celebrity: {
        id: celebrity.id,
        slug: celebrity.slug,
        name: celebrityLocalization.name,
        image: celebrity.image_url,
      },
      brand: {
        slug: brand.slug,
        name: brandLocalization.name,
        logo: brand.logo_url,
        websiteUrl: brand.website_url,
        productContext: brandLocalization.description,
      },
      overrides: (overridesResult.data ?? []).map((override) => ({
        effectiveStatus: override.effective_status,
        effectiveFrom: override.effective_from,
        effectiveUntil: override.effective_until,
        createdAt: override.created_at,
      })),
    };
  }

  async findViewer(appUserId: string, event: LiveEventRecord): Promise<LiveViewerRecord> {
    const [passportResult, reservationResult] = await Promise.all([
      this.database.from("fan_passports").select("id").eq("app_user_id", appUserId).eq("celebrity_id", event.celebrity.id).eq("business_status", "issued").maybeSingle(),
      this.database.from("live_reservations").select("id, reserved_at").eq("app_user_id", appUserId).eq("live_event_id", event.id).maybeSingle(),
    ]);
    if (passportResult.error || reservationResult.error) throw new Error("Live viewer lookup failed");
    if (!reservationResult.data) {
      return { hasPassport: passportResult.data !== null, reservation: null };
    }

    const reservation = reservationResult.data;
    const { data: activity, error: activityError } = await this.database
      .from("fan_activities")
      .select("id")
      .eq("app_user_id", appUserId)
      .eq("activity_type", "reservation")
      .eq("source_type", "live_reservation")
      .eq("source_id", reservation.id)
      .maybeSingle();
    if (activityError) throw new Error("Reservation activity lookup failed");

    if (!activity) throw new Error("Reservation activity projection is incomplete");
    const { data: stampRow, error: stampError } = await this.database
      .from("stamps")
      .select("id, business_status, mint_status")
      .eq("activity_id", activity.id)
      .eq("stamp_type", "reservation")
      .maybeSingle();
    if (stampError) throw new Error("Reservation stamp lookup failed");
    if (!stampRow) throw new Error("Reservation stamp projection is incomplete");
    const stamp: LiveReservationSummary["stamp"] = {
      id: stampRow.id,
      businessStatus: stampRow.business_status,
      mintStatus: stampRow.mint_status,
    };
    return {
      hasPassport: passportResult.data !== null,
      reservation: { id: reservation.id, createdAt: reservation.reserved_at, stamp },
    };
  }
}

export function createLiveEventRepositoryFromEnvironment(config: {
  url: string;
  serviceRoleKey: string;
}): LiveEventRepository {
  const database = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new DefaultLiveEventRepository(new SupabaseLiveEventDataSource(database));
}
