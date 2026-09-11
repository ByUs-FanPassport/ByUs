"use client";
import { usePrivy } from "@privy-io/react-auth";
import { Archive, ExternalLink, Plus, Save, Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import { NoticeManager } from "./notice-manager";
import { ImageRoleEditor } from "./image-role-editor";
import { CREATOR_ROLES, creatorRoleLabel, type CreatorRole } from "@/features/creator/domain/creator-role";
import styles from "./admin.module.css";
import { AdminPagination, useAdminPagination } from "./admin-pagination";
import localStyles from "./celebrity-manager.module.css";
export type DeploymentEnvironment = "Development" | "Preview" | "Production";
type Loc = { name: string; summary: string; imageAlt: string };
type Social = {
  platform: "youtube" | "tiktok" | "instagram" | "chzzk";
  url: string;
  position: number;
  active: boolean;
};
type Theme = { slug: string; nameKo: string; nameEn: string; position: number };
type Celebrity = {
  id: string;
  slug: string;
  status: "draft" | "published";
  imageUrl: string;
  imagePosition: string;
  displayOrder: number;
  fanCount: number | null;
  primaryRole: CreatorRole | null;
  archivedAt: string | null;
  updatedAt: string;
  localizations: { ko: Loc; en: Loc };
  themes: Theme[];
  socialLinks: Social[];
};
type CelebrityDraft = Omit<
  Celebrity,
  "id" | "status" | "archivedAt" | "updatedAt"
>;
type PublicationFilter = "all" | "draft" | "published" | "archived";
const blank: CelebrityDraft = {
  slug: "",
  imageUrl: "",
  imagePosition: "center",
  displayOrder: 0,
  fanCount: null,
  primaryRole: null,
  localizations: {
    ko: { name: "", summary: "", imageAlt: "" },
    en: { name: "", summary: "", imageAlt: "" },
  },
  themes: [],
  socialLinks: [],
};
function publicationLabel(
  celebrity: Celebrity,
  locale: AdminLocale,
): string {
  if (celebrity.archivedAt) return locale === "ko" ? "보관됨" : "Archived";
  if (celebrity.status === "published")
    return locale === "ko" ? "공개 중" : "Published";
  return locale === "ko" ? "초안" : "Draft";
}
function isDraftValid(draft: CelebrityDraft): boolean {
  const localizationValid = (["ko", "en"] as const).every((locale) => {
    const item = draft.localizations[locale];
    return (
      item.name.trim().length >= 1 &&
      item.name.trim().length <= 120 &&
      item.summary.trim().length >= 1 &&
      item.summary.trim().length <= 1000 &&
      item.imageAlt.trim().length >= 1 &&
      item.imageAlt.trim().length <= 300
    );
  });
  const themesValid =
    draft.themes.length <= 12 &&
    draft.themes.every(
      (theme) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.slug) &&
        theme.nameKo.trim().length >= 1 &&
        theme.nameKo.trim().length <= 100 &&
        theme.nameEn.trim().length >= 1 &&
        theme.nameEn.trim().length <= 100,
    );
  const socialLinksValid =
    draft.socialLinks.length <= 3 &&
    draft.socialLinks.every((link) => {
      try {
        return new URL(link.url).protocol === "https:";
      } catch {
        return false;
      }
    });
  return (
    localizationValid &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) &&
    (draft.imageUrl.startsWith("/") || draft.imageUrl.startsWith("https://")) &&
    draft.imagePosition.trim().length >= 1 &&
    draft.imagePosition.trim().length <= 100 &&
    Number.isInteger(draft.displayOrder) &&
    draft.displayOrder >= 0 &&
    (draft.fanCount === null ||
      (Number.isInteger(draft.fanCount) && draft.fanCount >= 0)) &&
    draft.primaryRole !== null &&
    themesValid &&
    socialLinksValid
  );
}
export function AuthorizedCelebrityManager({
  environment,
}: {
  environment: DeploymentEnvironment;
}) {
  const session = useAdminSession();
  const locale: AdminLocale =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("lang") === "en"
      ? "en"
      : "ko";
  if (session.status !== "authorized")
    return <AdminAccessState status={session.status} locale={locale} />;
  return (
    <CelebrityCms
      role={session.admin.role}
      locale={locale}
      environment={environment}
    />
  );
}
function CelebrityCms({
  role,
  locale,
  environment,
}: {
  role: string;
  locale: AdminLocale;
  environment: DeploymentEnvironment;
}) {
  const { getAccessToken } = usePrivy(),
    canEdit = role !== "viewer";
  const [items, setItems] = useState<Celebrity[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState(blank),
    [lang, setLang] = useState<AdminLocale>("ko"),
    [query, setQuery] = useState(""),
    [publicationFilter, setPublicationFilter] =
      useState<PublicationFilter>("all"),
    [state, setState] = useState<"loading" | "ready" | "error" | "saving">(
      "loading",
    ),
    [message, setMessage] = useState("");
  const request = useCallback(
    async (method: string, body?: unknown) => {
      const token = await getAccessToken();
      if (!token) throw new Error();
      const r = await fetch("/api/admin/celebrities", {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-correlation-id": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        throw new Error(p.message || p.error || "request failed");
      }
      return r.json();
    },
    [getAccessToken],
  );
  const load = useCallback(async () => {
    setState("loading");
    try {
      const p = (await request("GET")) as { items: Celebrity[] };
      setItems(p.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  const current = items.find((x) => x.id === selected);
  useEffect(() => {
    if (current)
      setDraft({
        slug: current.slug,
        imageUrl: current.imageUrl,
        imagePosition: current.imagePosition,
        displayOrder: current.displayOrder,
        fanCount: current.fanCount,
        primaryRole: current.primaryRole,
        localizations: current.localizations,
        themes: current.themes,
        socialLinks: current.socialLinks,
      });
  }, [current]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const publication = item.archivedAt ? "archived" : item.status;
      const matchesPublication =
        publicationFilter === "all" || publication === publicationFilter;
      const matchesQuery = [
        item.slug,
        item.localizations.ko?.name,
        item.localizations.en?.name,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
      return matchesPublication && matchesQuery;
    });
  }, [items, publicationFilter, query]);
  const pagination = useAdminPagination(filtered, JSON.stringify([query, publicationFilter]));
  const draftIsValid = useMemo(() => isDraftValid(draft), [draft]);
  async function command(body: unknown) {
    setState("saving");
    setMessage("");
    try {
      await request("POST", body);
      await load();
      setMessage(
        locale === "ko" ? "변경사항을 저장했습니다." : "Changes saved.",
      );
    } catch (e) {
      setState("ready");
      setMessage(e instanceof Error ? e.message : "Error");
    }
  }
  const updateLoc = (key: keyof Loc, value: string) =>
    setDraft((d) => ({
      ...d,
      localizations: {
        ...d.localizations,
        [lang]: { ...d.localizations[lang], [key]: value },
      },
    }));
  return (
    <AdminOperationsShell locale={locale} adminRole={role}>
      <div className={styles.cmsHeading}>
        <div>
          <p>{locale === "ko" ? "콘텐츠 관리" : "Content management"} · {environment === "Production" ? (locale === "ko" ? "운영 환경" : "Production") : environment === "Preview" ? (locale === "ko" ? "미리보기 환경" : "Preview") : (locale === "ko" ? "개발 환경" : "Development")}</p>
          <h1>{locale === "ko" ? "크리에이터 관리" : "Creator management"}</h1>
          <span>
            {locale === "ko"
              ? "프로필을 미리 보고 공개 상태와 팬 퀴즈를 관리합니다."
              : "Preview profiles, publication, and fan quizzes."}
          </span>
        </div>
        {canEdit && (
          <button
            className={styles.cmsPrimary}
            onClick={() => {
              setSelected(null);
              setDraft(blank);
              setLang("ko");
              setMessage("");
            }}
          >
            <Plus aria-hidden="true" />{" "}
            {locale === "ko" ? "새 크리에이터" : "New creator"}
          </button>
        )}
      </div>
      <div className={styles.cmsGrid}>
        <section
          className={styles.cmsList}
          aria-label={locale === "ko" ? "크리에이터 목록" : "Creator list"}
        >
          <div className={localStyles.listHeading}>
            <strong>{locale === "ko" ? "크리에이터 목록" : "Creators"}</strong>
            <span>
              {locale === "ko"
                ? `${filtered.length}개 검색 결과 · 전체 ${items.length}개`
                : `${filtered.length} results · ${items.length} total`}
            </span>
          </div>
          <div className={localStyles.listFilters}>
            <label className={`${styles.searchField} ${localStyles.searchField}`}>
              <Search aria-hidden="true" />
              <span className={styles.srOnly}>
                {locale === "ko" ? "이름 또는 주소 검색" : "Search name or slug"}
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  locale === "ko" ? "이름 또는 주소 검색" : "Search name or slug"
                }
              />
            </label>
            <label className={localStyles.statusField}>
              <span>{locale === "ko" ? "공개 상태" : "Publication status"}</span>
              <select
                value={publicationFilter}
                onChange={(event) =>
                  setPublicationFilter(event.target.value as PublicationFilter)
                }
              >
                <option value="all">{locale === "ko" ? "전체" : "All"}</option>
                <option value="published">
                  {locale === "ko" ? "공개 중" : "Published"}
                </option>
                <option value="draft">{locale === "ko" ? "초안" : "Draft"}</option>
                <option value="archived">
                  {locale === "ko" ? "보관됨" : "Archived"}
                </option>
              </select>
            </label>
            {(query || publicationFilter !== "all") && (
              <button
                type="button"
                className={localStyles.clearFilters}
                onClick={() => {
                  setQuery("");
                  setPublicationFilter("all");
                }}
              >
                {locale === "ko" ? "조건 지우기" : "Clear filters"}
              </button>
            )}
          </div>
          {state === "loading" ? (
            <p>{locale === "ko" ? "목록을 불러오는 중입니다." : "Loading list."}</p>
          ) : state === "error" ? (
            <p role="alert">
              {locale === "ko"
                ? "크리에이터 목록을 불러오지 못했습니다."
                : "Creator list could not be loaded."}
              <button type="button" onClick={() => void load()}>{locale === "ko" ? "다시 시도" : "Retry"}</button>
            </p>
          ) : filtered.length === 0 ? (
            <p>
              {locale === "ko"
                ? "조건에 맞는 크리에이터가 없습니다."
                : "No celebrities match these filters."}
            </p>
          ) : (
            pagination.items.map((x) => (
              <button
                key={x.id}
                className={selected === x.id ? styles.cmsListActive : ""}
                onClick={() => setSelected(x.id)}
              >
                <img src={x.imageUrl} alt="" />
                <span>
                  <strong>{x.localizations[locale]?.name || x.slug}</strong>
                  <small>
                    {x.primaryRole ? creatorRoleLabel(x.primaryRole, locale) : null}
                  </small>
                  <small>
                    {x.slug} · {publicationLabel(x, locale)}
                  </small>
                </span>
              </button>
            ))
          )}
          {(state === "ready" || state === "saving") && <AdminPagination {...pagination} locale={locale} disabled={state === "saving"} />}
        </section>
        <section className={styles.cmsEditor}>
          <div className={localStyles.editorIdentity}>
            <p>
              {current
                ? publicationLabel(current, locale)
                : locale === "ko"
                  ? "새 초안"
                  : "New draft"}
            </p>
            <h2>
              {current
                ? locale === "ko"
                  ? `${current.localizations.ko?.name || current.slug} 편집`
                  : `Edit ${current.localizations.en?.name || current.slug}`
                : locale === "ko"
                  ? "새 크리에이터 등록"
                  : "Create celebrity"}
            </h2>
            <span>
              {locale === "ko"
                ? "KO·EN 필수 정보를 모두 입력해야 저장할 수 있습니다."
                : "Complete all required KO and EN fields before saving."}
            </span>
          </div>
          <div className={styles.cmsToolbar}>
            <div role="group" aria-label="Language">
              <button
                className={lang === "ko" ? styles.cmsTabActive : ""}
                onClick={() => setLang("ko")}
              >
                KO
              </button>
              <button
                className={lang === "en" ? styles.cmsTabActive : ""}
                onClick={() => setLang("en")}
              >
                EN
              </button>
            </div>
            {current && (
              <span
                className={
                  current.status === "published"
                    ? styles.cmsPublished
                    : styles.draftBadge
                }
              >
                {publicationLabel(current, locale)}
              </span>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draftIsValid) {
                setMessage(
                  locale === "ko"
                    ? "KO·EN 필수 정보와 주소 경로, 이미지, 직군, 테마·채널 형식을 확인하세요."
                    : "Check required KO and EN fields, slug, image, role, theme, and channel formats.",
                );
                return;
              }
              void command({
                action: "save",
                celebrityId: selected,
                payload: draft,
              });
            }}
            className={styles.cmsForm}
          >
            <fieldset disabled={!canEdit || !!current?.archivedAt}>
              <legend>{locale === "ko" ? "기본 정보" : "Profile"}</legend>
              <label>
                <span>{lang === "ko" ? "이름" : "Name"}</span>
                <input
                  required
                  maxLength={120}
                  value={draft.localizations[lang].name}
                  onChange={(e) => updateLoc("name", e.target.value)}
                />
              </label>
              <label>
                <span>{lang === "ko" ? "소개" : "Summary"}</span>
                <textarea
                  required
                  maxLength={1000}
                  value={draft.localizations[lang].summary}
                  onChange={(e) => updateLoc("summary", e.target.value)}
                />
              </label>
              <label>
                <span>
                  {lang === "ko" ? "이미지 대체 텍스트" : "Image alt"}
                </span>
                <input
                  required
                  maxLength={300}
                  value={draft.localizations[lang].imageAlt}
                  onChange={(e) => updateLoc("imageAlt", e.target.value)}
                />
              </label>
              <div className={styles.fieldGrid}>
                <label>
                  <span>{locale === "ko" ? "주소 경로" : "URL path"}</span>
                  <input
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    value={draft.slug}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, slug: e.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{locale === "ko" ? "정렬 순서" : "Sort order"}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.displayOrder}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        displayOrder: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{locale === "ko" ? "통합 팬 수" : "Total fans"}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.fanCount ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        fanCount:
                          e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    aria-describedby="fan-count-help"
                  />
                  <small id="fan-count-help">
                    {locale === "ko"
                      ? "공개하려면 0 이상의 정수가 필요합니다."
                      : "A non-negative integer is required before publishing."}
                  </small>
                </label>
              </div>
              <label>
                <span>
                  {locale === "ko"
                    ? "기본 이미지 URL (초안 생성용)"
                    : "Fallback image URL (draft creation)"}
                </span>
                <input
                  required
                  disabled={Boolean(current)}
                  aria-label={
                    locale === "ko"
                      ? "기본 이미지 URL (초안 생성용)"
                      : "Fallback image URL (draft creation)"
                  }
                  value={draft.imageUrl}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, imageUrl: e.target.value }))
                  }
                />
                {current && (
                  <small>
                    {locale === "ko"
                      ? "저장된 크리에이터 이미지는 아래 공개 이미지 역할에서 변경합니다."
                      : "Use Public image roles below for a saved celebrity."}
                  </small>
                )}
              </label>
              <label>
                <span>
                  {locale === "ko"
                    ? "기본 이미지 위치 (초안 생성용)"
                    : "Fallback image position (draft creation)"}
                </span>
                <input
                  required
                  maxLength={100}
                  disabled={Boolean(current)}
                  aria-label={
                    locale === "ko"
                      ? "기본 이미지 위치 (초안 생성용)"
                      : "Fallback image position (draft creation)"
                  }
                  value={draft.imagePosition}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, imagePosition: e.target.value }))
                  }
                />
              </label>
            </fieldset>
            <fieldset disabled={!canEdit || !!current?.archivedAt}>
              <legend>
                {locale === "ko" ? "직군과 채널" : "Role and channels"}
              </legend>
              <label>
                <span>{locale === "ko" ? "대표 직군" : "Primary role"}</span>
                <select required value={draft.primaryRole ?? ""} onChange={(event) => setDraft((d) => ({ ...d, primaryRole: event.target.value as CreatorRole }))}>
                  <option value="" disabled>{locale === "ko" ? "직군을 선택하세요" : "Select a role"}</option>
                  {CREATOR_ROLES.map((role) => <option key={role} value={role}>{creatorRoleLabel(role, locale)}</option>)}
                </select>
              </label>
              <label>
                <span>
                  {locale === "ko"
                    ? "테마 (한 줄에 주소 경로|한국어 이름|영어 이름)"
                    : "Themes (slug|KO|EN per line)"}
                </span>
                <textarea
                  value={draft.themes
                    .map((t) => `${t.slug}|${t.nameKo}|${t.nameEn}`)
                    .join("\n")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      themes: e.target.value
                        .split("\n")
                        .filter(Boolean)
                        .map((row, position) => {
                          const [slug, nameKo, nameEn] = row.split("|");
                          return { slug, nameKo, nameEn, position };
                        }),
                    }))
                  }
                />
              </label>
              <h3 className={styles.cmsSubheading}>
                {locale === "ko" ? "소셜 링크" : "Social links"}
              </h3>
              <small className={localStyles.fieldHelp}>
                {locale === "ko"
                  ? `HTTPS 채널을 최대 3개까지 등록할 수 있습니다. (${draft.socialLinks.length}/3)`
                  : `Add up to 3 HTTPS channels. (${draft.socialLinks.length}/3)`}
              </small>
              {(["youtube", "tiktok", "instagram", "chzzk"] as const).map(
                (platform, position) => (
                  <label key={platform}>
                    <span>{platform}</span>
                    <input
                      type="url"
                      disabled={
                        draft.socialLinks.length >= 3 &&
                        !draft.socialLinks.some((x) => x.platform === platform)
                      }
                      value={
                        draft.socialLinks.find((x) => x.platform === platform)
                          ?.url || ""
                      }
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          socialLinks: [
                            ...d.socialLinks.filter(
                              (x) => x.platform !== platform,
                            ),
                            ...(e.target.value
                              ? [
                                  {
                                    platform,
                                    url: e.target.value,
                                    position,
                                    active: true,
                                  },
                                ]
                              : []),
                          ],
                        }))
                      }
                    />
                  </label>
                ),
              )}
            </fieldset>
            <aside className={styles.cmsPreview}>
              <span>
                {locale === "ko" ? "팬 화면 미리보기" : "Fan preview"}
              </span>
              {draft.imageUrl && (
                <img
                  src={draft.imageUrl}
                  alt={draft.localizations[lang].imageAlt}
                />
              )}
              <h2>{draft.localizations[lang].name || "—"}</h2>
              {draft.fanCount !== null && (
                <p>
                  {new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(draft.fanCount)}{" "}
                  Fans
                </p>
              )}
              <p>{draft.localizations[lang].summary || "—"}</p>
            </aside>
            {message && (
              <p role="status" className={styles.cmsMessage}>
                {message}
              </p>
            )}
            {!message && (
              <p className={`${styles.cmsMessage} ${localStyles.validationNote}`}>
                {draftIsValid
                  ? locale === "ko"
                    ? "필수 정보가 입력되어 저장할 수 있습니다."
                    : "Required information is complete and ready to save."
                  : locale === "ko"
                    ? "KO·EN 필수 정보와 주소 경로, 이미지, 직군, 테마·채널 형식을 확인하세요."
                    : "Check required KO and EN fields, slug, image, role, theme, and channel formats."}
              </p>
            )}
            <div className={styles.formActions}>
              {current && (
                <Link
                  href={`/admin/celebrities/${current.id}/quiz` as Route}
                  className={styles.secondaryButton}
                >
                  <ExternalLink aria-hidden="true" />
                  {locale === "ko" ? "팬 퀴즈" : "Fan quiz"}
                </Link>
              )}
              {canEdit && (
                <>
                  <button
                    type="submit"
                    className={styles.secondaryButton}
                    disabled={state === "saving" || !draftIsValid}
                  >
                    <Save aria-hidden="true" />
                    {current
                      ? locale === "ko"
                        ? "변경 저장"
                        : "Save changes"
                      : locale === "ko"
                        ? "초안 저장"
                        : "Save draft"}
                  </button>
                  {current && !current.archivedAt && (
                    <button
                      type="button"
                      className={styles.cmsPrimary}
                      onClick={() =>
                        void command({
                          action:
                            current.status === "published"
                              ? "unpublish"
                              : "publish",
                          celebrityId: current.id,
                        })
                      }
                    >
                      {current.status === "published"
                        ? locale === "ko"
                          ? "공개 중지"
                          : "Unpublish"
                        : locale === "ko"
                          ? "공개하기"
                          : "Publish"}
                    </button>
                  )}
                  {current && !current.archivedAt && (
                    <button
                      type="button"
                      className={styles.cmsDanger}
                      onClick={() => {
                        const reason = prompt(
                          locale === "ko"
                            ? "보관 사유를 10자 이상 입력하세요."
                            : "Enter an archive reason (10+ characters).",
                        );
                        if (reason)
                          void command({
                            action: "archive",
                            celebrityId: current.id,
                            reason,
                          });
                      }}
                    >
                      <Archive aria-hidden="true" />
                      {locale === "ko" ? "보관" : "Archive"}
                    </button>
                  )}
                </>
              )}
            </div>
          </form>
          {current ? (
            <ImageRoleEditor
              key={current.id}
              ownerType="celebrity"
              ownerId={current.id}
              locale={locale}
              canEdit={canEdit && !Boolean(current.archivedAt)}
              getAccessToken={getAccessToken}
            />
          ) : (
            <p className={styles.cmsMessage}>
              {locale === "ko"
                ? "새 크리에이터의 기본 정보를 초안으로 저장하면 역할별 이미지를 등록할 수 있습니다."
                : "Save the new celebrity as a draft before assigning image roles."}
            </p>
          )}
        </section>
      </div>
      {current && (
        <NoticeManager
          key={current.id}
          celebrityId={current.id}
          celebrityName={current.localizations[locale]?.name || current.slug}
          role={role}
          locale={locale}
        />
      )}
    </AdminOperationsShell>
  );
}
