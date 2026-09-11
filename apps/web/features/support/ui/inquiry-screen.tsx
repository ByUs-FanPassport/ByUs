"use client";

import { usePrivy } from "@privy-io/react-auth";
import { FanAppFrame, FanContentContainer, type FanLocale } from "@/components/fan-shell/fan-app-shell";
import { FanAction } from "@/components/fan-ui/fan-action";
import { FanState } from "@/components/fan-ui/fan-state";
import { appendLoginContext } from "@/components/login-intent";
import { AdminOperationsShell } from "@/components/admin/operations-shell";
import { AdminAccessState } from "@/components/admin/admin-access-state";
import { useAdminSession } from "@/components/admin/use-admin-session";
import { InquiryWorkspace } from "./inquiry-workspace";
import { supportCopy } from "./copy";
import styles from "./inquiry.module.css";

export function InquiryScreen({ locale, id }: { locale: FanLocale; id?: string }) {
  const auth = usePrivy();
  const t = supportCopy[locale];
  const path = id ? `/my/inquiries/${id}` : "/my/inquiries";
  const loginHref = appendLoginContext("/login", { returnTo: path, intent: null, entity: null, locale });
  return <FanAppFrame locale={locale} currentPath={path} mainId="inquiries-content">
    <FanContentContainer as="main" id="inquiries-content" tabIndex={-1} className={styles.main}>
      {!auth.ready ? <FanState kind="loading" title={t.loading} />
        : !auth.authenticated ? <section className={styles.guest}><h1>{t.loginTitle}</h1><p>{t.loginHelp}</p><FanAction variant="primary" href={loginHref}>{t.login}</FanAction></section>
          : <InquiryWorkspace key={`${auth.user?.id}:${id ?? "list"}`} locale={locale} id={id} />}
    </FanContentContainer>
  </FanAppFrame>;
}

export function AdminInquiryScreen({ locale, id }: { locale: FanLocale; id?: string }) {
  const auth = usePrivy();
  const session = useAdminSession();
  if (session.status !== "authorized") return <AdminAccessState status={session.status} locale={locale} />;
  return <AdminOperationsShell locale={locale} adminRole={session.admin.role}>
    <div className={styles.adminMain}><InquiryWorkspace key={`${auth.user?.id}:${session.admin.role}:${id ?? "list"}`} locale={locale} id={id} admin readonly={session.admin.role === "viewer"} /></div>
  </AdminOperationsShell>;
}
