import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminSession } from "../admin/admin-session-gate";
import { z } from "zod";
import { normalizePublicImage } from "../media/public-image-processing";
import {
  parseNoticeDocument,
  type NoticeLocale,
  type PublicNoticeDetail,
  type PublicNoticeSummary,
} from "./notice-domain";

type Config = Readonly<{ url: string; serviceRoleKey: string }>;
type AdminNoticeInput = Readonly<{
  id?: string;
  expectedRevision?: number;
  celebrityId: string;
  slug: string;
  pinned: boolean;
  postType?: "notice" | "artist_post";
  visibility?: "public" | "members";
  localizations: Readonly<{
    ko: Readonly<{ title: string; body: unknown }>;
    en: Readonly<{ title: string; body: unknown }>;
  }>;
}>;

export class NoticeRepositoryError extends Error {}

export class NoticeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listPublic(input: {
    celebritySlug: string;
    locale: NoticeLocale;
    cursor?: string | null;
    limit?: number;
    surface?: "home";
  }): Promise<{ notices: PublicNoticeSummary[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 20);
    const offset = input.cursor
      ? Number.parseInt(Buffer.from(input.cursor, "base64url").toString("utf8"), 10)
      : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new NoticeRepositoryError("Invalid Notice cursor");
    }
    let query = this.db
      .from("celebrity_notices")
      .select("id,slug,notice_kind,pinned,published_at,celebrities!inner(slug,status,archived_at),celebrity_notice_localizations!inner(locale,title)")
      .eq("celebrities.slug", input.celebritySlug)
      .eq("celebrities.status", "published")
      .is("celebrities.archived_at", null)
      .eq("publication_status", "published")
      .eq("visibility", "public")
      .is("archived_at", null)
      .eq("celebrity_notice_localizations.locale", input.locale);
    // Order before pagination so a welcome notice cannot hide news on home.
    if (input.surface === "home") query = query.order("notice_kind", { ascending: true });
    query = query.order("pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit);
    const { data, error } = await query;
    if (error) throw new NoticeRepositoryError(error.message);
    const rows = data ?? [];
    const notices = rows.slice(0, limit).map((row: any) => ({
      slug: row.slug,
      pinned: row.pinned,
      kind: row.notice_kind,
      publishedAt: row.published_at,
      title: Array.isArray(row.celebrity_notice_localizations)
        ? row.celebrity_notice_localizations[0]?.title
        : row.celebrity_notice_localizations?.title,
    }));
    return {
      notices,
      nextCursor: rows.length > limit
        ? Buffer.from(String(offset + limit)).toString("base64url")
        : null,
    };
  }

  async findPublic(input: {
    celebritySlug: string;
    noticeSlug: string;
    locale: NoticeLocale;
  }): Promise<PublicNoticeDetail | null> {
    const { data, error } = await this.db
      .from("celebrity_notices")
      .select("slug,notice_kind,pinned,published_at,celebrities!inner(slug,status,archived_at),celebrity_notice_localizations!inner(locale,title,body_json)")
      .eq("slug", input.noticeSlug)
      .eq("celebrities.slug", input.celebritySlug)
      .eq("celebrities.status", "published")
      .is("celebrities.archived_at", null)
      .eq("publication_status", "published")
      .eq("visibility", "public")
      .is("archived_at", null)
      .eq("celebrity_notice_localizations.locale", input.locale)
      .maybeSingle();
    if (error) throw new NoticeRepositoryError(error.message);
    if (!data) return null;
    const localization: any = Array.isArray((data as any).celebrity_notice_localizations)
      ? (data as any).celebrity_notice_localizations[0]
      : (data as any).celebrity_notice_localizations;
    return {
      slug: data.slug,
      title: localization.title,
      body: parseNoticeDocument(localization.body_json),
      pinned: data.pinned,
      kind: data.notice_kind,
      publishedAt: data.published_at!,
    };
  }

  async listAdmin(admin: AdminSession, celebrityId: string) {
    const { data, error } = await this.db
      .from("celebrity_notices")
      .select("id,celebrity_id,slug,publication_status,pinned,post_type,visibility,published_at,archived_at,archive_reason,revision,created_at,celebrity_notice_localizations(locale,title,body_json)")
      .eq("celebrity_id", celebrityId)
      .order("created_at", { ascending: false });
    if (error) throw new NoticeRepositoryError(error.message);
    return { role: admin.role, notices: data ?? [] };
  }

  async save(admin: AdminSession, correlationId: string, input: AdminNoticeInput) {
    if (admin.role === "viewer") throw new NoticeRepositoryError("viewer is read-only");
    const ko = { ...input.localizations.ko, body: parseNoticeDocument(input.localizations.ko.body) };
    const en = { ...input.localizations.en, body: parseNoticeDocument(input.localizations.en.body) };
    const { data, error } = await this.db.rpc("save_admin_celebrity_notice", {
      p_actor_app_user_id: admin.appUserId,
      p_actor_admin_allowlist_id: admin.allowlistId,
      p_correlation_id: correlationId,
      p_notice_id: input.id ?? null,
      p_expected_revision: input.expectedRevision ?? null,
      p_celebrity_id: input.celebrityId,
      p_slug: input.slug,
      p_pinned: input.pinned,
      p_title_ko: ko.title.trim(),
      p_body_ko: ko.body,
      p_title_en: en.title.trim(),
      p_body_en: en.body,
      ...(input.postType !== undefined && input.visibility !== undefined ? { p_post_type: input.postType, p_visibility: input.visibility } : {}),
    });
    if (error) throw new NoticeRepositoryError(error.message);
    return { id: data };
  }

  async state(admin: AdminSession, correlationId: string, input: {
    id: string;
    expectedRevision: number;
    action: "publish" | "unpublish" | "archive";
    reason?: string;
  }) {
    if (admin.role === "viewer") throw new NoticeRepositoryError("viewer is read-only");
    const { error } = await this.db.rpc("set_admin_celebrity_notice_state", {
      p_actor_app_user_id: admin.appUserId,
      p_actor_admin_allowlist_id: admin.allowlistId,
      p_correlation_id: correlationId,
      p_notice_id: input.id,
      p_expected_revision: input.expectedRevision,
      p_action: input.action,
      p_reason: input.reason ?? null,
    });
    if (error) throw new NoticeRepositoryError(error.message);
    return { ok: true };
  }

  async upload(admin: AdminSession, input: {
    celebrityId: string;
    noticeId: string;
    file: File;
  }): Promise<{ url: string }> {
    if (admin.role === "viewer") throw new NoticeRepositoryError("viewer is read-only");
    if (!["image/jpeg", "image/png", "image/webp"].includes(input.file.type) || input.file.size > 8 * 1024 * 1024) {
      throw new NoticeRepositoryError("Only JPEG, PNG, or WebP images up to 8MB are allowed");
    }
    const { data: notice, error: noticeError } = await this.db
      .from("celebrity_notices")
      .select("id")
      .eq("id", input.noticeId)
      .eq("celebrity_id", input.celebrityId)
      .is("archived_at", null)
      .maybeSingle();
    if (noticeError) throw new NoticeRepositoryError(noticeError.message);
    if (!notice) throw new NoticeRepositoryError("Notice not found");
    const image = await normalizePublicImage(new Uint8Array(await input.file.arrayBuffer()));
    const { data, error } = await this.db.rpc("reserve_admin_content_asset", {
      p_actor_app_user_id: admin.appUserId, p_actor_admin_allowlist_id: admin.allowlistId,
      p_celebrity_id: input.celebrityId, p_byte_size: image.bytes.byteLength,
      p_width: image.width, p_height: image.height, p_sha256: image.sha256,
    });
    if (error) throw new NoticeRepositoryError(error.message);
    const asset = z.object({ id: z.uuid(), storagePath: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/) }).strict().parse(data);
    try {
      const uploaded = await this.db.storage.from("fan-content-assets").upload(asset.storagePath, image.bytes, { contentType: "image/webp", cacheControl: "0", upsert: false });
      if (uploaded.error) throw new NoticeRepositoryError("Upload failed");
      const finished = await this.db.rpc("finish_content_asset_upload", { p_app_user_id: admin.appUserId, p_asset_id: asset.id });
      if (finished.error) throw new NoticeRepositoryError(finished.error.message);
    } catch (error) {
      await this.db.rpc("abandon_content_asset_upload", { p_app_user_id: admin.appUserId, p_asset_id: asset.id });
      throw error;
    }
    return { url: `/api/content-assets/${asset.id}` };
  }
}

export function createNoticeRepository(config: Config, client?: SupabaseClient) {
  return new NoticeRepository(client ?? createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }) },
  }));
}
