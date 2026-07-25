import type { ReactNode } from "react";

import type { FanLocale } from "./fan-app-shell";
import { FanSiteFooter } from "./fan-site-footer";
import { FocusFlowHeader } from "./focus-flow-header";
import styles from "./focus-flow-frame.module.css";

export function FocusFlowFrame({
  locale,
  children,
  headerActions,
  mainId,
  showFooter = false,
  stickyHeader = false,
}: {
  locale: FanLocale;
  children: ReactNode;
  headerActions?: ReactNode;
  mainId?: string;
  showFooter?: boolean;
  stickyHeader?: boolean;
}) {
  return (
    <div className={styles.frame} data-fan-surface lang={locale}>
      {mainId ? (
        <a className={styles.skipLink} href={`#${mainId}`}>
          {locale === "ko" ? "본문으로 바로가기" : "Skip to content"}
        </a>
      ) : null}
      <FocusFlowHeader
        className={styles.header}
        innerClassName={styles.headerInner}
        locale={locale}
        sticky={stickyHeader}
      >
        {headerActions ?? <span />}
      </FocusFlowHeader>
      {children}
      {showFooter ? <FanSiteFooter locale={locale} /> : null}
    </div>
  );
}
