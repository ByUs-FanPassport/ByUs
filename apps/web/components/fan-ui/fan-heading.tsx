import type { ReactNode } from "react";
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

/** Shared title / description / accessory pattern; each variant preserves its incumbent rhythm. */
export function FanSectionHeader({ title, description, accessory, variant = "standard", as = "h2", id }: {
  title: ReactNode;
  description?: ReactNode;
  accessory?: ReactNode;
  variant?: "standard" | "editorial" | "personal";
  as?: "h1" | "h2" | "h3";
  id?: string;
}) {
  return <div className={`${styles.sectionHeader} ${styles[variant]}`} data-fan-section-header={variant}>
    <div className={styles.copy}>
      <FanHeading as={as} id={id} variant={variant === "personal" ? "personal-section" : variant}>{title}</FanHeading>
      {description != null ? <p className={styles.description}>{description}</p> : null}
    </div>
    {accessory}
  </div>;
}
