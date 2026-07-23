"use client";
import { usePrivy } from "@privy-io/react-auth";
import { Archive, ExternalLink, Plus, Save, Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import styles from "./admin.module.css";
export type DeploymentEnvironment = "Development" | "Preview" | "Production";
type Loc = { name: string; summary: string; imageAlt: string };
type Social = {
  platform: "youtube" | "tiktok" | "instagram";
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
  archivedAt: string | null;
  updatedAt: string;
  localizations: { ko: Loc; en: Loc };
  themes: Theme[];
  socialLinks: Social[];
};
const blank: Omit<Celebrity, "id" | "status" | "archivedAt" | "updatedAt"> = {
  slug: "",
  imageUrl: "",
  imagePosition: "center",
  displayOrder: 0,
  fanCount: null,
  localizations: {
    ko: { name: "", summary: "", imageAlt: "" },
    en: { name: "", summary: "", imageAlt: "" },
  },
  themes: [],
  socialLinks: [],
};
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
        localizations: current.localizations,
        themes: current.themes,
        socialLinks: current.socialLinks,
      });
  }, [current]);
  const filtered = useMemo(
    () =>
      items.filter((x) =>
        (x.localizations.ko?.name || x.slug)
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [items, query],
  );
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
    <AdminOperationsShell locale={locale}>
      <div className={styles.cmsHeading}>
        <div>
          <p>ADM-003 · {environment}</p>
          <h1>{locale === "ko" ? "셀럽 콘텐츠" : "Celebrity content"}</h1>
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
            }}
          >
            <Plus aria-hidden="true" />{" "}
            {locale === "ko" ? "새 셀럽" : "New celebrity"}
          </button>
        )}
      </div>
      <div className={styles.cmsGrid}>
        <section
          className={styles.cmsList}
          aria-label={locale === "ko" ? "셀럽 목록" : "Celebrity list"}
        >
          <label className={styles.searchField}>
            <Search aria-hidden="true" />
            <span className={styles.srOnly}>Search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={locale === "ko" ? "이름 검색" : "Search names"}
            />
          </label>
          {state === "loading" ? (
            <p>Loading…</p>
          ) : (
            filtered.map((x) => (
              <button
                key={x.id}
                className={selected === x.id ? styles.cmsListActive : ""}
                onClick={() => setSelected(x.id)}
              >
                <img src={x.imageUrl} alt="" />
                <span>
                  <strong>{x.localizations[locale]?.name || x.slug}</strong>
                  <small>
                    {x.slug} · {x.archivedAt ? "ARCHIVED" : x.status}
                  </small>
                </span>
              </button>
            ))
          )}
        </section>
        <section className={styles.cmsEditor}>
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
                {current.archivedAt ? "ARCHIVED" : current.status.toUpperCase()}
              </span>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
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
                  value={draft.localizations[lang].name}
                  onChange={(e) => updateLoc("name", e.target.value)}
                />
              </label>
              <label>
                <span>{lang === "ko" ? "소개" : "Summary"}</span>
                <textarea
                  required
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
                  value={draft.localizations[lang].imageAlt}
                  onChange={(e) => updateLoc("imageAlt", e.target.value)}
                />
              </label>
              <div className={styles.fieldGrid}>
                <label>
                  <span>Slug</span>
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
                <span>{locale === "ko" ? "이미지 URL" : "Image URL"}</span>
                <input
                  required
                  value={draft.imageUrl}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, imageUrl: e.target.value }))
                  }
                />
              </label>
              <label>
                <span>object-position</span>
                <input
                  required
                  value={draft.imagePosition}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, imagePosition: e.target.value }))
                  }
                />
              </label>
            </fieldset>
            <fieldset disabled={!canEdit || !!current?.archivedAt}>
              <legend>
                {locale === "ko" ? "분류와 채널" : "Taxonomy and channels"}
              </legend>
              <label>
                <span>
                  {locale === "ko"
                    ? "테마 (한 줄에 slug|한국어|English)"
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
              {(["youtube", "tiktok", "instagram"] as const).map(
                (platform, position) => (
                  <label key={platform}>
                    <span>{platform}</span>
                    <input
                      type="url"
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
            <div className={styles.formActions}>
              {current && (
                <Link
                  href={`/admin/celebrities/${current.id}/quiz` as Route}
                  className={styles.secondaryButton}
                >
                  <ExternalLink aria-hidden="true" /> Quiz
                </Link>
              )}
              {canEdit && (
                <>
                  <button
                    type="submit"
                    className={styles.secondaryButton}
                    disabled={state === "saving"}
                  >
                    <Save aria-hidden="true" />
                    {locale === "ko" ? "저장" : "Save"}
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
                          ? "발행"
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
        </section>
      </div>
    </AdminOperationsShell>
  );
}
