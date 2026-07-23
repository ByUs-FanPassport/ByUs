import type { ReactNode } from "react";
import type { Route } from "next";
import { FanWordmarkLink } from "./fan-wordmark-link";
import styles from "./fan-compact-header.module.css";

export function FanCompactHeader({ brandAriaLabel, brandHref, children }: { brandAriaLabel?: string; brandHref?: Route; children: ReactNode }) {
  return (
    <header className={styles.header}>
      <FanWordmarkLink ariaLabel={brandAriaLabel} className={styles.brand} href={brandHref} />
      {children}
    </header>
  );
}
