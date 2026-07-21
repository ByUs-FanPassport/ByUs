"use client";

import { Menu, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./operations.module.css";

export type AdminLocale = "ko" | "en";

const copy = {
  ko: { menu: "관리자 메뉴", overview: "개요", celebrities: "셀럽 콘텐츠", analytics: "분석", jobs: "블록체인 작업", audit: "감사 로그", language: "English", environment: "운영" },
  en: { menu: "Admin menu", overview: "Overview", celebrities: "Celebrity content", analytics: "Analytics", jobs: "Blockchain jobs", audit: "Audit log", language: "한국어", environment: "Operations" },
} as const;

export function AdminOperationsShell({ locale, children }: { locale: AdminLocale; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const t = copy[locale];

  function switchLocale() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("lang", locale === "ko" ? "en" : "ko");
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  }

  const nav = (
    <nav aria-label={t.menu}>
      <Link className={pathname === "/admin" ? styles.activeNav : undefined} aria-current={pathname === "/admin" ? "page" : undefined} href={(locale === "en" ? "/admin?lang=en" : "/admin") as Route}>{t.overview}</Link>
      <Link href={(locale === "en" ? "/admin/celebrities?lang=en" : "/admin/celebrities") as Route}>{t.celebrities}</Link>
      <Link className={pathname === "/admin/dashboard" ? styles.activeNav : undefined} aria-current={pathname === "/admin/dashboard" ? "page" : undefined} href={(locale === "en" ? "/admin/dashboard?view=creator&lang=en" : "/admin/dashboard?view=creator") as Route}>{t.analytics}</Link>
      <Link className={pathname === "/admin/blockchain-jobs" ? styles.activeNav : undefined} aria-current={pathname === "/admin/blockchain-jobs" ? "page" : undefined} href={(locale === "en" ? "/admin/blockchain-jobs?lang=en" : "/admin/blockchain-jobs") as Route}>{t.jobs}</Link>
      <Link className={pathname === "/admin/audit" ? styles.activeNav : undefined} aria-current={pathname === "/admin/audit" ? "page" : undefined} href={(locale === "en" ? "/admin/audit?lang=en" : "/admin/audit") as Route}>{t.audit}</Link>
    </nav>
  );

  return <div className={styles.adminPage}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href={(locale === "en" ? "/admin?lang=en" : "/admin") as Route}>ByUs <span>Admin</span></Link>
      <div className={styles.topActions}>
        <span className={styles.environment}>{t.environment}</span>
        <button className={styles.languageButton} type="button" onClick={switchLocale}>{t.language}</button>
        <button className={styles.menuButton} type="button" aria-label={t.menu} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}</button>
      </div>
    </header>
    {menuOpen && <div className={styles.mobileNav}>{nav}</div>}
    <div className={styles.layout}>
      <aside className={styles.sidebar}>{nav}</aside>
      <main className={styles.workspace} id="main-content">{children}</main>
    </div>
  </div>;
}
