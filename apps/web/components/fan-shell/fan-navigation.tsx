import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

import styles from "./fan-navigation.module.css";

type LinkHref = ComponentProps<typeof Link>["href"];

export type FanNavigationItem = {
  href: LinkHref;
  icon?: ReactNode;
  id: string;
  isCurrent?: boolean;
  label: ReactNode;
};

type FanNavigationProps = {
  activeItemClassName?: string;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
  items: readonly FanNavigationItem[];
};

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function FanPrimaryNavigation({
  activeItemClassName,
  ariaLabel,
  className,
  itemClassName,
  items,
}: FanNavigationProps) {
  return (
    <nav className={className} aria-label={ariaLabel}>
      {items.map((item) => (
        <Link
          key={item.id}
          className={classNames(
            styles.navigationItem,
            itemClassName,
            item.isCurrent ? activeItemClassName : undefined,
          )}
          aria-current={item.isCurrent ? "page" : undefined}
          href={item.href}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function FanBottomNavigation(props: FanNavigationProps) {
  return (
    <FanPrimaryNavigation
      {...props}
      itemClassName={classNames(styles.bottomNavigationItem, props.itemClassName)}
    />
  );
}

type FanLocaleLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: LinkHref;
};

export function FanLocaleLink({ className, ...props }: FanLocaleLinkProps) {
  return <Link className={classNames(styles.localeLink, className)} {...props} />;
}
