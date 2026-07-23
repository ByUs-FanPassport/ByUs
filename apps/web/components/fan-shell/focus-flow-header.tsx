import type { ReactNode } from "react";

import { FanWordmarkLink } from "./fan-wordmark-link";
import styles from "./focus-flow-header.module.css";

type FocusFlowHeaderProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  sticky?: boolean;
};

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function FocusFlowHeader({ children, className, innerClassName, sticky = false }: FocusFlowHeaderProps) {
  return (
    <header className={classes(styles.header, sticky && styles.sticky, className)}>
      <div className={classes(styles.inner, innerClassName)}>
        <FanWordmarkLink className={styles.wordmark} />
        {children}
      </div>
    </header>
  );
}
