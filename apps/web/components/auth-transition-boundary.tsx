"use client";

import { isCreatorHandle } from "@/features/creator/domain/creator-navigation";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useAppLocale } from "./locale-provider";
import { useByUsSession } from "./byus-session-provider";
import styles from "./auth-transition-boundary.module.css";

function hasHomeTabOnly(searchParams?: Pick<URLSearchParams, "getAll"> | null): boolean {
  const tabs = searchParams?.getAll("tab") ?? [];
  return tabs.length === 0 || (tabs.length === 1 && tabs[0] === "home");
}

/** Audited pages whose public shell is safe to show while a new session is prepared. */
export function isPublicSessionTransitionRoute(
  pathname: string,
  searchParams?: Pick<URLSearchParams, "getAll"> | null,
): boolean {
  if (pathname === "/" || pathname === "/my" || pathname === "/passports") return true;
  if (/^\/passports\/[^/]+\/?$/.test(pathname)) return true;
  if (pathname === "/live" || pathname === "/live/calendar") return true;
  if (/^\/live\/[^/]+\/?$/.test(pathname) && pathname !== "/live/calendar/") return true;

  const canonicalCreator = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (canonicalCreator && isCreatorHandle(canonicalCreator)) return hasHomeTabOnly(searchParams);
  const creatorAlias = /^\/c\/([^/]+)\/?$/.exec(pathname)?.[1];
  return Boolean(creatorAlias && isCreatorHandle(creatorAlias) && hasHomeTabOnly(searchParams));
}

export function AuthTransitionBoundary({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale } = useAppLocale();
  const session = useByUsSession();

  // Login owns recovery UI and must remain reachable while the transaction is in error.
  if (pathname === "/login") return <>{children}{modal}</>;
  if (session.ready) return <>{children}{modal}</>;

  if (isPublicSessionTransitionRoute(pathname, searchParams)) {
    return (
      <>
        {children}
        <div className={styles.status} role="status" aria-live="polite">
          {session.pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
          <span>{session.error
            ? locale === "ko" ? "로그인 연결을 마치지 못했어요." : "We couldn't finish sign-in."
            : locale === "ko" ? "로그인을 마무리하고 있어요." : "Finishing sign-in."}</span>
          {session.error && session.recoveryPath ? <Link href={session.recoveryPath as Route}>{locale === "ko" ? "다시 시도" : "Try again"}</Link> : null}
        </div>
      </>
    );
  }

  // Do not mount either route subtree until its owner-scoped session is ready.
  return (
    <main className={styles.fallback} aria-busy="true">
      <div className={styles.fallbackCard}>
        {session.pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
        <p role="status">{session.error
          ? locale === "ko" ? "로그인 연결을 마치지 못했어요." : "We couldn't finish sign-in."
          : locale === "ko" ? "로그인을 마무리하고 있어요." : "Finishing sign-in."}</p>
        {session.error && session.recoveryPath ? <Link href={session.recoveryPath as Route}>{locale === "ko" ? "로그인 화면에서 다시 시도" : "Try again from sign-in"}</Link> : null}
      </div>
    </main>
  );
}
