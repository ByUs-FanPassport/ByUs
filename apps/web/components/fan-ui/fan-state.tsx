import type { ReactNode } from "react";

import styles from "./fan-state.module.css";

type FanStateProps = Readonly<{
  kind: "loading" | "empty" | "error" | "auth";
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>;

export function FanState({
  kind,
  title,
  description,
  icon,
  actions,
  className,
}: FanStateProps) {
  return (
    <section
      className={[styles.state, className ?? ""].filter(Boolean).join(" ")}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={kind === "loading"}
    >
      {icon}
      {kind === "loading" ? <p>{title}</p> : <h2>{title}</h2>}
      {description ? <p>{description}</p> : null}
      {kind === "loading" ? <span className={styles.loadingBar} aria-hidden="true" /> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
