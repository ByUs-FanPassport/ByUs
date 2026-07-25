import type { ReactNode } from "react";

import type { FanLocale } from "./fan-app-shell";
import { FanWordmarkLink } from "./fan-wordmark-link";
import styles from "./focus-flow-header.module.css";

type FocusFlowHeaderProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  locale?: FanLocale;
  mainId?: string;
  sticky?: boolean;
};

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function FocusFlowHeader({
  children,
  className,
  innerClassName,
  locale = "ko",
  mainId,
  sticky = false,
}: FocusFlowHeaderProps) {
  return (
    <>
      {mainId ? (
        <a className={styles.skipLink} href={`#${mainId}`}>
          {locale === "ko" ? "본문으로 바로가기" : "Skip to content"}
        </a>
      ) : null}
      <header className={classes(styles.header, sticky && styles.sticky, className)}>
        <div className={classes(styles.inner, innerClassName)}>
          <FanWordmarkLink className={styles.wordmark} locale={locale} />
          {children}
        </div>
      </header>
    </>
  );
}
