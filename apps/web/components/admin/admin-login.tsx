"use client";

import { useLogin } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { GoogleMark } from "../icons";
import styles from "./admin.module.css";
import { useAdminSession } from "./use-admin-session";

export type AdminAccessState = "unauthenticated" | "checking" | "denied";

export function AdminLogin({ access = "unauthenticated" }: { access?: AdminAccessState }) {
  const { login } = useLogin();
  const router = useRouter();
  const session = useAdminSession();
  useEffect(() => {
    if (session.status === "authorized") router.replace("/admin/celebrities");
  }, [router, session.status]);
  const resolvedAccess = access !== "unauthenticated"
    ? access
    : session.status === "denied"
      ? "denied"
      : session.status === "loading" || session.status === "authorized"
        ? "checking"
        : "unauthenticated";
  const isDenied = resolvedAccess === "denied";
  const isChecking = resolvedAccess === "checking";

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginPanel} aria-labelledby="admin-login-heading">
        <Link className={styles.wordmark} href="/" aria-label="ByUs 홈으로 돌아가기">ByUs</Link>
        <div className={styles.loginHeading}>
          <span className={styles.iconTile} aria-hidden="true"><LockKeyhole /></span>
          <div>
            <p className={styles.productLabel}>ByUs Admin</p>
            <h1 id="admin-login-heading">운영자 로그인</h1>
          </div>
        </div>

        {isDenied ? (
          <div className={styles.deniedNotice} role="alert">
            <strong>등록된 관리자 계정이 아닙니다</strong>
            <p>관리자 데이터는 표시되지 않았습니다. 권한이 필요하다면 ByUs 운영 책임자에게 계정 등록을 요청해 주세요.</p>
          </div>
        ) : isChecking ? (
          <div className={styles.checkingNotice} role="status" aria-live="polite">
            <ShieldCheck aria-hidden="true" />
            <div><strong>관리자 권한을 확인합니다</strong><p>서버에서 등록된 이메일과 역할을 확인한 뒤에만 운영 화면을 엽니다.</p></div>
          </div>
        ) : (
          <>
            <p className={styles.loginDescription}>등록된 Sallylab Google 계정으로만 접근할 수 있습니다. 팬 계정 로그인과 별도로 관리자 권한을 다시 확인합니다.</p>
            <button
              className={styles.googleButton}
              type="button"
              disabled={session.status === "loading"}
              onClick={() => login({ loginMethods: ["google"] })}
            >
              <GoogleMark /><span>{session.status === "loading" ? "로그인 준비 중" : "Google로 관리자 로그인"}</span><ArrowRight aria-hidden="true" />
            </button>
            <p className={styles.securityNote}>로그인 후 서버에서 관리자 권한을 확인합니다.</p>
          </>
        )}

        <Link className={styles.backLink} href="/"><ArrowLeft aria-hidden="true" /> 팬 화면으로 돌아가기</Link>
      </section>
    </main>
  );
}
