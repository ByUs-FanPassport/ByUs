"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import type { AppLocale } from "@/i18n/locales";
import { accountDeletionCopy } from "@/i18n/catalogs/features__profile__ui__account-deletion";
import { FanAction } from "@/components/fan-ui/fan-action";
import styles from "./settings-screen.module.css";

const resultSchema = z.object({ deletion: z.object({ status: z.enum(["pending", "completed"]) }) });
export function AccountDeletion({ locale }: { locale: AppLocale }) {
  const auth = usePrivy();
  return <OwnerDeletion key={auth.user?.id ?? "guest"} locale={locale} auth={auth}/>;
}
function OwnerDeletion({ locale, auth }: { locale: AppLocale; auth: ReturnType<typeof usePrivy> }) {
  const t = accountDeletionCopy[locale];
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<"pending" | "completed" | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE" || pending.current || !auth.authenticated) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const token = await auth.getAccessToken();
      if (!token || !alive.current) throw new Error("Session unavailable");
      const response = await fetch("/api/me/account", { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }), cache: "no-store" });
      if (!response.ok) throw new Error("Deletion unavailable");
      const result = resultSchema.parse(await response.json());
      if (alive.current) setAccepted(result.deletion.status);
    } catch { if (alive.current) setError(t.failed); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function leave() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await auth.logout(); router.replace(`/?locale=${locale}`); }
    catch { if (alive.current) setError(t.logoutFailed); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  if (!auth.authenticated) return null;
  return <section className={styles.section} aria-labelledby="account-deletion-title">
    <div className={styles.sectionTitle}><div className={styles.icon}><Trash2 aria-hidden="true"/></div><div><h2 id="account-deletion-title">{t.title}</h2><p>{t.body}</p></div></div>
    {accepted ? <><p role="status">{t[accepted]}</p><FanAction disabled={busy} onClick={() => void leave()}>{t.leave}</FanAction></> : <>
      <form className={styles.renameForm} onSubmit={submit}>
        <label htmlFor="account-deletion-confirmation">{t.confirm}</label>
        <input id="account-deletion-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy}/>
        <FanAction type="submit" disabled={busy || confirmation !== "DELETE"}>{busy ? t.busy : t.action}</FanAction>
      </form></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
