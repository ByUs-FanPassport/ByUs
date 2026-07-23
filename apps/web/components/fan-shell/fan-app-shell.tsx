"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "next";
import { BookOpen, Heart, Home, Radio } from "lucide-react";
import Link from "next/link";

import { Languages } from "../icons";
import { FanHeader } from "./fan-header";
import {
  FanBottomNavigation,
  FanPrimaryNavigation,
  type FanNavigationItem,
} from "./fan-navigation";
import styles from "./fan-app-shell.module.css";

export type FanLocale = "ko" | "en";
export type FanSection = "home" | "live" | "favorites" | "my";

function useBrowserPathname() {
  const [pathname, setPathname] = useState("/");
  useEffect(() => setPathname(window.location.pathname), []);
  return pathname;
}

export function activeFanSection(pathname: string): FanSection {
  if (pathname === "/live" || pathname.startsWith("/live/")) return "live";
  if (pathname === "/celebrities" || pathname.startsWith("/c/")) return "favorites";
  if (
    pathname === "/my" ||
    pathname.startsWith("/passports") ||
    pathname.startsWith("/stamps") ||
    pathname.startsWith("/benefits") ||
    pathname.startsWith("/notifications") ||
    pathname.startsWith("/settings")
  ) return "my";
  return "home";
}

export function fanNavigationItems(
  locale: FanLocale,
  pathname: string,
): readonly FanNavigationItem[] {
  const current = activeFanSection(pathname);
  const query = `?locale=${locale}`;
  return [
    { id: "home", href: `/${query}` as Route, label: "HOME", isCurrent: current === "home" },
    { id: "live", href: `/live${query}` as Route, label: "LIVE", isCurrent: current === "live" },
    {
      id: "favorites",
      href: `/celebrities${query}` as Route,
      label: locale === "ko" ? "최애" : "FAVORITES",
      isCurrent: current === "favorites",
    },
    { id: "my", href: `/my${query}` as Route, label: "MY", isCurrent: current === "my" },
  ];
}

const icons: Record<FanSection, ReactNode> = {
  home: <Home aria-hidden="true" />,
  live: <Radio aria-hidden="true" />,
  favorites: <Heart aria-hidden="true" />,
  my: <BookOpen aria-hidden="true" />,
};

function mobileLabel(section: FanSection, locale: FanLocale) {
  if (section === "home") return locale === "ko" ? "홈" : "Home";
  if (section === "live") return "LIVE";
  if (section === "favorites") return locale === "ko" ? "최애" : "Favorites";
  return "MY";
}

export function FanAppHeader({
  locale,
  actions,
}: {
  locale: FanLocale;
  actions?: ReactNode;
}) {
  const pathname = useBrowserPathname();
  const items = fanNavigationItems(locale, pathname);
  const nextLocale = locale === "ko" ? "en" : "ko";

  return (
    <FanHeader
      className={styles.header}
      innerClassName={styles.headerInner}
      brandClassName={styles.brand}
      brandHref={`/?locale=${locale}` as Route}
      brandAriaLabel={locale === "ko" ? "ByUs 홈" : "ByUs home"}
    >
      <FanPrimaryNavigation
        activeItemClassName={styles.activeNav}
        ariaLabel={locale === "ko" ? "주요 메뉴" : "Primary navigation"}
        className={styles.desktopNav}
        itemClassName={styles.desktopNavItem}
        items={items}
      />
      <div className={styles.actions}>
        <Link
          className={styles.language}
          href={`${pathname}?locale=${nextLocale}` as Route}
          aria-label={locale === "ko" ? "언어 선택, 현재 한국어" : "Choose language, currently English"}
        >
          <Languages aria-hidden="true" />
        </Link>
        {actions}
      </div>
    </FanHeader>
  );
}

export function FanAppBottomNavigation({ locale }: { locale: FanLocale }) {
  const pathname = useBrowserPathname();
  const items = fanNavigationItems(locale, pathname).map((item) => ({
    ...item,
    icon: icons[item.id as FanSection],
    label: <span>{mobileLabel(item.id as FanSection, locale)}</span>,
  }));
  return (
    <FanBottomNavigation
      activeItemClassName={styles.activeBottomItem}
      ariaLabel={locale === "ko" ? "모바일 주요 메뉴" : "Mobile primary navigation"}
      className={styles.bottomNavigation}
      itemClassName={styles.bottomNavigationItem}
      items={items}
    />
  );
}

export function FanAppFrame({
  locale,
  children,
  actions,
  className,
}: {
  locale: FanLocale;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.frame, className].filter(Boolean).join(" ")}>
      <FanAppHeader locale={locale} actions={actions} />
      {children}
      <FanAppBottomNavigation locale={locale} />
    </div>
  );
}
