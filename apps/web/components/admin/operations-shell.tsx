"use client";

import {
  Activity, BadgeCheck, BarChart3, Bell, Blocks, ChevronRight,
  Clapperboard, ExternalLink, Gift, LayoutDashboard, Menu,
  MessageSquareText, ScrollText, Sparkles, UsersRound, X, type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./operations.module.css";

export type AdminLocale = "ko" | "en";
type NavItem = { href: Route; icon: LucideIcon; label: string; exact?: boolean };
type RawItem = readonly [Route, string, LucideIcon, boolean?];

const copy = {
  ko: {
    menu: "관리자 메뉴", admin: "관리자", breadcrumb: "현재 위치",
    language: "English", environment: "운영", openService: "서비스 열기",
    groups: [
      { label: "서비스 현황", items: [["/admin", "서비스 현황", LayoutDashboard, true], ["/admin/dashboard", "상세 통계", BarChart3]] },
      { label: "회원", items: [["/admin/fans", "회원 관리", UsersRound], ["/admin/certifications", "인증 심사", BadgeCheck]] },
      { label: "콘텐츠", items: [["/admin/celebrities", "크리에이터 관리", Sparkles], ["/admin/lives", "LIVE 관리", Clapperboard], ["/admin/benefits", "혜택·경품", Gift], ["/admin/notice-comments", "공지 댓글", MessageSquareText]] },
      { label: "운영 관리", items: [["/admin/system", "시스템 상태", Activity], ["/admin/blockchain-jobs", "디지털 발급 내역", Blocks], ["/admin/notifications", "알림 전송", Bell], ["/admin/audit", "관리자 활동 기록", ScrollText]] },
    ],
  },
  en: {
    menu: "Admin menu", admin: "Admin", breadcrumb: "Breadcrumb",
    language: "한국어", environment: "Operations", openService: "Open service",
    groups: [
      { label: "Service status", items: [["/admin", "Service status", LayoutDashboard, true], ["/admin/dashboard", "Detailed analytics", BarChart3]] },
      { label: "Members", items: [["/admin/fans", "Member management", UsersRound], ["/admin/certifications", "Certification review", BadgeCheck]] },
      { label: "Content", items: [["/admin/celebrities", "Creator management", Sparkles], ["/admin/lives", "LIVE management", Clapperboard], ["/admin/benefits", "Benefits & prizes", Gift], ["/admin/notice-comments", "Notice comments", MessageSquareText]] },
      { label: "Operations", items: [["/admin/system", "System status", Activity], ["/admin/blockchain-jobs", "Issuance history", Blocks], ["/admin/notifications", "Notification delivery", Bell], ["/admin/audit", "Admin activity log", ScrollText]] },
    ],
  },
} as const;

export function AdminOperationsShell({ locale, children }: { locale: AdminLocale; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const t = copy[locale];
  const groups = t.groups.map((group) => ({
    label: group.label,
    items: (group.items as readonly RawItem[]).map(([href, label, icon, exact = false]) => ({ href, label, icon, exact })),
  }));

  useEffect(() => {
    if (!menuOpen) return;
    const currentLink = mobileNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const firstLink = mobileNavRef.current?.querySelector<HTMLElement>("a");
    (currentLink ?? firstLink)?.focus();
  }, [menuOpen]);

  function switchLocale() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("lang", locale === "ko" ? "en" : "ko");
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  }
  function isActive(item: NavItem) {
    return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  function localizedHref(href: Route) {
    return (locale === "en" ? `${href}?lang=en` : href) as Route;
  }
  function handleMobileNavKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  const currentItem = groups.flatMap((group) => group.items).find(isActive);
  const nav = (
    <nav className={styles.adminNav} aria-label={t.menu}>
      {groups.map((group) => (
        <div className={styles.navGroup} key={group.label}>
          <p>{group.label}</p>
          {group.items.map((item) => {
            const active = isActive(item);
            const Icon = item.icon;
            return (
              <Link key={item.href} className={active ? styles.activeNav : undefined}
                aria-current={active ? "page" : undefined} href={localizedHref(item.href)}>
                <Icon aria-hidden="true" /><span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={styles.adminPage}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href={localizedHref("/admin")}>ByUs <span>Admin</span></Link>
        <div className={styles.topActions}>
          <span className={styles.environment}>{t.environment}</span>
          <Link className={styles.serviceLink} href="/" target="_blank">{t.openService}<ExternalLink aria-hidden="true" /></Link>
          <button className={styles.languageButton} type="button" onClick={switchLocale}>{t.language}</button>
          <button ref={menuButtonRef} className={styles.menuButton} type="button" aria-label={t.menu}
            aria-expanded={menuOpen} aria-controls="admin-mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>
      {menuOpen && (
        <div ref={mobileNavRef} id="admin-mobile-navigation" className={styles.mobileNav}
          onKeyDown={handleMobileNavKeyDown} onClick={() => setMenuOpen(false)}>
          {nav}
        </div>
      )}
      <div className={styles.layout}>
        <aside className={styles.sidebar}>{nav}</aside>
        <main className={styles.workspace} id="main-content">
          {currentItem && (
            <nav className={styles.breadcrumb} aria-label={t.breadcrumb}>
              <Link href={localizedHref("/admin")}>{t.admin}</Link>
              <ChevronRight aria-hidden="true" />
              <span aria-current="page">{currentItem.label}</span>
            </nav>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
