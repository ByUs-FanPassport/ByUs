"use client";

import { usePrivy } from "@privy-io/react-auth";
import { AlertCircle, RefreshCw, Search, ShieldCheck, UserPlus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AdminRole } from "@/features/auth/domain/admin-authorization";
import { adminDirectoryEntrySchema, adminDirectorySchema, type AdminDirectoryEntry } from "@/features/auth/domain/admin-directory";
import { AdminAccessState } from "./admin-access-state";
import { AdminOperationsShell, type AdminLocale } from "./operations-shell";
import { useAdminSession } from "./use-admin-session";
import { AlertDialog } from "../ui/overlay/accessible-overlay";
import styles from "./admin-directory-manager.module.css";

type DirectoryItem = AdminDirectoryEntry;

type DirectoryErrorCode =
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "ADMIN_DIRECTORY_DUPLICATE_EMAIL"
  | "ADMIN_DIRECTORY_NOT_FOUND"
  | "ADMIN_DIRECTORY_SELF_CHANGE"
  | "ADMIN_DIRECTORY_LAST_ADMIN"
  | "ADMIN_DIRECTORY_CONFLICT"
  | "ADMIN_DIRECTORY_UNAVAILABLE";

type PendingChange =
  | { kind: "role"; item: DirectoryItem; role: AdminRole }
  | { kind: "active"; item: DirectoryItem; active: boolean };

const roles: readonly AdminRole[] = ["admin", "operator", "viewer"];

const copy = {
  ko: {
    eyebrow: "접근 권한", title: "관리자 관리", description: "운영 도구에 접근할 관리자를 추가하고 역할과 활성 상태를 관리합니다.",
    addTitle: "관리자 추가", email: "이메일", emailPlaceholder: "admin@example.com", role: "역할", add: "관리자 추가", adding: "추가 중…",
    search: "이메일 검색", searchPlaceholder: "이메일로 검색", count: (visible: number, total: number) => `${total}명 중 ${visible}명`,
    status: "상태", active: "활성", inactive: "접근 해제", updated: "최근 변경", actions: "작업", saveRole: "역할 저장", saving: "저장 중…",
    deactivate: "접근 해제", reactivate: "재활성화", self: "내 계정", selfHelp: "현재 로그인한 계정의 역할과 상태는 여기서 변경할 수 없습니다.",
    loading: "관리자 명단을 불러오는 중입니다.", empty: "등록된 관리자가 없습니다.", emptySearch: "검색 결과가 없습니다.",
    emptyHelp: "위 양식에서 첫 관리자를 추가하세요.", emptySearchHelp: "다른 이메일로 검색해 보세요.", loadError: "관리자 명단을 불러오지 못했습니다.", retry: "다시 시도",
    added: "관리자를 추가했습니다.", roleSaved: "역할을 변경했습니다.", deactivated: "관리자 접근 권한을 해제했습니다.", reactivated: "관리자를 재활성화했습니다.",
    confirmRoleTitle: "역할을 변경할까요?", confirmRoleBody: (email: string, role: AdminRole) => `${email}의 역할을 ${role}로 변경합니다.`,
    confirmDeactivateTitle: "관리자 접근을 해제할까요?", confirmDeactivateBody: (email: string) => `${email}은 더 이상 관리자 도구에 접근할 수 없습니다. 회원 계정과 변경 이력은 유지됩니다.`,
    confirmReactivateTitle: "관리자를 재활성화할까요?", confirmReactivateBody: (email: string) => `${email}의 관리자 접근 권한을 다시 활성화합니다.`,
    cancel: "취소", confirm: "변경", refresh: "목록 새로고침",
    errors: {
      INVALID_INPUT: "이메일과 역할을 확인해 주세요.", ADMIN_DIRECTORY_DUPLICATE_EMAIL: "이미 등록된 이메일입니다.",
      ADMIN_DIRECTORY_NOT_FOUND: "관리자 정보를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
      ADMIN_DIRECTORY_SELF_CHANGE: "현재 로그인한 계정의 역할이나 상태는 변경할 수 없습니다.",
      ADMIN_DIRECTORY_LAST_ADMIN: "마지막 활성 admin은 강등하거나 접근 해제할 수 없습니다.",
      ADMIN_DIRECTORY_CONFLICT: "다른 관리자가 먼저 변경했습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.",
      ADMIN_DIRECTORY_UNAVAILABLE: "관리자 관리 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      FORBIDDEN: "관리자 관리 권한이 없습니다.", UNAUTHENTICATED: "관리자 로그인이 필요합니다.",
    },
  },
  en: {
    eyebrow: "Access control", title: "Admin management", description: "Add people who can access operations tools and manage their roles and access status.",
    addTitle: "Add administrator", email: "Email", emailPlaceholder: "admin@example.com", role: "Role", add: "Add administrator", adding: "Adding…",
    search: "Search by email", searchPlaceholder: "Search email", count: (visible: number, total: number) => `${visible} of ${total}`,
    status: "Status", active: "Active", inactive: "Access revoked", updated: "Last updated", actions: "Actions", saveRole: "Save role", saving: "Saving…",
    deactivate: "Revoke access", reactivate: "Reactivate", self: "Your account", selfHelp: "You cannot change the role or status of the account you are currently using.",
    loading: "Loading administrators.", empty: "No administrators are registered.", emptySearch: "No administrators match your search.",
    emptyHelp: "Add the first administrator using the form above.", emptySearchHelp: "Try another email address.", loadError: "Administrators could not be loaded.", retry: "Try again",
    added: "Administrator added.", roleSaved: "Role updated.", deactivated: "Administrator access revoked.", reactivated: "Administrator reactivated.",
    confirmRoleTitle: "Change this role?", confirmRoleBody: (email: string, role: AdminRole) => `Change ${email} to the ${role} role.`,
    confirmDeactivateTitle: "Revoke administrator access?", confirmDeactivateBody: (email: string) => `${email} will no longer be able to access admin tools. Their member account and audit history will remain.`,
    confirmReactivateTitle: "Reactivate this administrator?", confirmReactivateBody: (email: string) => `Restore administrator access for ${email}.`,
    cancel: "Cancel", confirm: "Confirm", refresh: "Refresh list",
    errors: {
      INVALID_INPUT: "Check the email address and role.", ADMIN_DIRECTORY_DUPLICATE_EMAIL: "This email is already registered.",
      ADMIN_DIRECTORY_NOT_FOUND: "This administrator could not be found. Refresh the list and try again.",
      ADMIN_DIRECTORY_SELF_CHANGE: "You cannot change the role or status of your current account.",
      ADMIN_DIRECTORY_LAST_ADMIN: "The last active admin cannot be demoted or have access revoked.",
      ADMIN_DIRECTORY_CONFLICT: "Another administrator updated this record first. Refresh the list and try again.",
      ADMIN_DIRECTORY_UNAVAILABLE: "Admin management is unavailable. Try again later.",
      FORBIDDEN: "You do not have permission to manage administrators.", UNAUTHENTICATED: "Admin sign-in is required.",
    },
  },
} as const;

function localeFrom(value: string | null): AdminLocale { return value === "en" ? "en" : "ko"; }
function errorCode(response: Response, body: unknown): DirectoryErrorCode {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === "string") return code as DirectoryErrorCode;
  if (response.status === 401) return "UNAUTHENTICATED";
  if (response.status === 403) return "FORBIDDEN";
  return "ADMIN_DIRECTORY_UNAVAILABLE";
}
function formatDate(value: string, locale: AdminLocale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export function AdminDirectoryManager() {
  const session = useAdminSession();
  const { getAccessToken, user } = usePrivy();
  const params = useSearchParams();
  const locale = localeFrom(params.get("lang"));
  const [revokedIdentity, setRevokedIdentity] = useState<string | null>(null);
  const identity = session.status === "authorized" ? `${user?.id ?? ""}:${session.admin.email}` : null;

  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  if (session.admin.role !== "admin" || revokedIdentity === identity) return <AdminAccessState status="denied" locale={locale} />;

  return (
    <DirectoryContent
      key={identity}
      locale={locale}
      getAccessToken={getAccessToken}
      onAccessDenied={() => setRevokedIdentity(identity)}
    />
  );
}

function DirectoryContent({ locale, getAccessToken, onAccessDenied }: { locale: AdminLocale; getAccessToken: () => Promise<string | null>; onAccessDenied: () => void }) {
  const t = copy[locale];
  const [items, setItems] = useState<DirectoryItem[]>([]);
  const [actorId, setActorId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("viewer");
  const [draftRoles, setDraftRoles] = useState<Record<string, AdminRole>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string; refresh?: boolean } | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const handleFailure = useCallback((response: Response, body: unknown) => {
    const code = errorCode(response, body);
    if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") {
      setItems([]);
      onAccessDenied();
      return;
    }
    setMessage({ type: "error", text: t.errors[code] ?? t.errors.ADMIN_DIRECTORY_UNAVAILABLE, refresh: code === "ADMIN_DIRECTORY_CONFLICT" || code === "ADMIN_DIRECTORY_NOT_FOUND" });
  }, [onAccessDenied, t.errors]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setItems([]);
    setMessage(null);
    setState("loading");
    try {
      const token = await getAccessToken();
      if (!token || controller.signal.aborted) throw new Error("missing token");
      const response = await fetch("/api/admin/administrators", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!activeRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        handleFailure(response, body);
        if (response.status !== 401 && response.status !== 403) setState("error");
        return;
      }
      const directory = adminDirectorySchema.safeParse(body);
      if (!directory.success) throw new Error("invalid response");
      setItems(directory.data.items);
      setActorId(directory.data.actorId);
      setDraftRoles(Object.fromEntries(directory.data.items.map((item) => [item.id, item.role])));
      setState("ready");
    } catch (error) {
      if (!activeRef.current || controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setState("error");
    }
  }, [getAccessToken, handleFailure]);

  useEffect(() => { void load(); }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newEmail.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!activeRef.current || !token) throw new Error("missing token");
      const response = await fetch("/api/admin/administrators", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      const body = await response.json().catch(() => null) as { item?: unknown } | null;
      if (!activeRef.current) return;
      if (!response.ok) { handleFailure(response, body); return; }
      const item = adminDirectoryEntrySchema.safeParse(body?.item);
      if (!item.success) throw new Error("invalid response");
      setItems((current) => [...current.filter((currentItem) => currentItem.id !== item.data.id), item.data].sort((a, b) => a.email.localeCompare(b.email)));
      setDraftRoles((current) => ({ ...current, [item.data.id]: item.data.role }));
      setNewEmail(""); setNewRole("viewer"); setMessage({ type: "success", text: t.added });
    } catch { if (activeRef.current) setMessage({ type: "error", text: t.errors.ADMIN_DIRECTORY_UNAVAILABLE }); }
    finally { if (activeRef.current) setBusy(false); }
  }

  async function applyChange() {
    if (!pending || busy || pending.item.id === actorId) return;
    setBusy(true);
    setMessage(null);
    const body = pending.kind === "role"
      ? { id: pending.item.id, role: pending.role, active: pending.item.active, expectedUpdatedAt: pending.item.updatedAt }
      : { id: pending.item.id, role: pending.item.role, active: pending.active, expectedUpdatedAt: pending.item.updatedAt };
    try {
      const token = await getAccessToken();
      if (!activeRef.current || !token) throw new Error("missing token");
      const response = await fetch("/api/admin/administrators", {
        method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { item?: unknown } | null;
      if (!activeRef.current) return;
      if (!response.ok) { handleFailure(response, payload); setPending(null); return; }
      const item = adminDirectoryEntrySchema.safeParse(payload?.item);
      if (!item.success) throw new Error("invalid response");
      setItems((current) => current.map((currentItem) => currentItem.id === item.data.id ? item.data : currentItem));
      setDraftRoles((current) => ({ ...current, [item.data.id]: item.data.role }));
      setMessage({ type: "success", text: pending.kind === "role" ? t.roleSaved : pending.active ? t.reactivated : t.deactivated });
      setPending(null);
    } catch { if (activeRef.current) setMessage({ type: "error", text: t.errors.ADMIN_DIRECTORY_UNAVAILABLE }); }
    finally { if (activeRef.current) setBusy(false); }
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? items.filter((item) => item.email.toLocaleLowerCase().includes(normalized)) : items;
  }, [items, query]);
  const dialog = pending?.kind === "role"
    ? { title: t.confirmRoleTitle, body: t.confirmRoleBody(pending.item.email, pending.role) }
    : pending?.kind === "active" && pending.active
      ? { title: t.confirmReactivateTitle, body: t.confirmReactivateBody(pending.item.email) }
      : pending?.kind === "active"
        ? { title: t.confirmDeactivateTitle, body: t.confirmDeactivateBody(pending.item.email) }
        : null;

  return <AdminOperationsShell locale={locale} adminRole="admin">
    <header className={styles.heading}><div><p>{t.eyebrow}</p><h1>{t.title}</h1><span>{t.description}</span></div><ShieldCheck aria-hidden="true" /></header>
    <section className={styles.addPanel} aria-labelledby="add-administrator-title">
      <h2 id="add-administrator-title">{t.addTitle}</h2>
      <form onSubmit={add}>
        <label className={styles.emailField}><span>{t.email}</span><input type="email" autoComplete="email" required value={newEmail} placeholder={t.emailPlaceholder} disabled={busy} onChange={(event) => setNewEmail(event.target.value)} /></label>
        <label><span>{t.role}</span><select value={newRole} disabled={busy} onChange={(event) => setNewRole(event.target.value as AdminRole)}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
        <button className={styles.primaryButton} type="submit" disabled={busy || !newEmail.trim()}><UserPlus aria-hidden="true" />{busy ? t.adding : t.add}</button>
      </form>
    </section>
    <section className={styles.directory} aria-labelledby="administrator-list-title">
      <div className={styles.toolbar}><div><h2 id="administrator-list-title">{t.title}</h2>{state === "ready" && <p>{t.count(filtered.length, items.length)}</p>}</div><label><span>{t.search}</span><div><Search aria-hidden="true" /><input type="search" value={query} placeholder={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></div></label></div>
      {message && <div className={message.type === "error" ? styles.errorMessage : styles.successMessage} role={message.type === "error" ? "alert" : "status"}><span>{message.text}</span>{message.refresh && <button type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />{t.refresh}</button>}</div>}
      {state === "loading" && <div className={styles.skeletonList} role="status" aria-label={t.loading}>{[1,2,3,4].map((number) => <div key={number} />)}</div>}
      {state === "error" && <StateMessage title={t.loadError} action={<button type="button" onClick={() => void load()}>{t.retry}</button>} />}
      {state === "ready" && filtered.length === 0 && <StateMessage title={query ? t.emptySearch : t.empty} body={query ? t.emptySearchHelp : t.emptyHelp} />}
      {state === "ready" && filtered.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th>{t.email}</th><th>{t.role}</th><th>{t.status}</th><th>{t.updated}</th><th>{t.actions}</th></tr></thead><tbody>{filtered.map((item) => {
        const self = item.id === actorId;
        const draftRole = draftRoles[item.id] ?? item.role;
        return <tr key={item.id} className={!item.active ? styles.inactiveRow : undefined}><td data-label={t.email}><strong>{item.email}</strong>{self && <span className={styles.selfBadge}>{t.self}</span>}{self && <small>{t.selfHelp}</small>}</td><td data-label={t.role}><select aria-label={`${t.role}: ${item.email}`} value={draftRole} disabled={busy || self} onChange={(event) => setDraftRoles((current) => ({ ...current, [item.id]: event.target.value as AdminRole }))}>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></td><td data-label={t.status}><span className={item.active ? styles.activeBadge : styles.inactiveBadge}><i aria-hidden="true" />{item.active ? t.active : t.inactive}</span></td><td data-label={t.updated}><time dateTime={item.updatedAt}>{formatDate(item.updatedAt, locale)}</time></td><td data-label={t.actions}><div className={styles.rowActions}><button type="button" disabled={busy || self || draftRole === item.role} onClick={() => setPending({ kind: "role", item, role: draftRole })}>{t.saveRole}</button><button className={item.active ? styles.revokeButton : undefined} type="button" disabled={busy || self} onClick={() => setPending({ kind: "active", item, active: !item.active })}>{item.active ? t.deactivate : t.reactivate}</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
    {pending && dialog && <AlertDialog open onClose={() => setPending(null)} labelledBy="admin-change-title" describedBy="admin-change-description" backdropClassName={styles.confirmBackdrop} contentClassName={styles.confirmDialog} busy={busy}><h2 id="admin-change-title">{dialog.title}</h2><p id="admin-change-description">{dialog.body}</p><div><button type="button" data-autofocus disabled={busy} onClick={() => setPending(null)}>{t.cancel}</button><button className={pending.kind === "active" && !pending.active ? styles.confirmDanger : styles.confirmPrimary} type="button" disabled={busy} onClick={() => void applyChange()}>{busy ? t.saving : t.confirm}</button></div></AlertDialog>}
  </AdminOperationsShell>;
}

function StateMessage({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return <div className={styles.stateMessage}><AlertCircle aria-hidden="true" /><h3>{title}</h3>{body && <p>{body}</p>}{action}</div>;
}
