import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "../icons";
import styles from "./fan-heading.module.css";

export type FanHeadingVariant = "standard" | "editorial" | "personal-page" | "personal-section";

/** Semantic level is independent of visual role. No style/className escape hatch. */
export function FanHeading({ as: Tag = "h2", variant = "standard", id, children }: {
  as?: "h1" | "h2" | "h3";
  variant?: FanHeadingVariant;
  id?: string;
  children: ReactNode;
}) {
  return <Tag id={id} className={`${styles.heading} ${styles[variant]}`} data-fan-heading={variant}>{children}</Tag>;
}

/** The title keeps its reading width; secondary navigation wraps below it. */
export function FanSectionHeader({ title, description, action, variant = "standard", as = "h2", id }: {
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; href: string };
  variant?: "standard" | "editorial" | "personal";
  as?: "h1" | "h2" | "h3";
  id?: string;
}) {
  return <div className={`${styles.sectionHeader} ${styles[variant]}`} data-fan-section-header={variant}>
    <div className={styles.copy}>
      <FanHeading as={as} id={id} variant={variant === "personal" ? "personal-section" : variant}>{title}</FanHeading>
      {description != null ? <p className={styles.description}>{description}</p> : null}
    </div>
    {action ? <Link className={styles.action} href={action.href as Route}><span>{action.label}</span><ChevronRight aria-hidden="true" /></Link> : null}
  </div>;
}
