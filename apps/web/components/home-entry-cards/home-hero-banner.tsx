import type { ReactNode } from "react";
import styles from "./home-hero-banner.module.css";

/** Every homepage slide uses the same image, information and action geometry. */
export function HomeHeroBanner({ image, eyebrow, title, description, action, desktopImage, kind = "guide" }: {
  image: ReactNode;
  desktopImage?: ReactNode;
  kind?: "live" | "guide";
  eyebrow: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action: ReactNode;
}) {
  return <div className={styles.banner} data-home-hero-banner data-kind={kind}>
    <div className={styles.image} data-hero-mobile-image>{image}</div>
    {desktopImage ? <div className={styles.desktopImage}>{desktopImage}</div> : null}
    <div className={styles.overlay} aria-hidden="true" />
    <div className={styles.copy}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <h2>{title}</h2>
      <div className={styles.description}>{description}</div>
      <div className={styles.action}>{action}</div>
    </div>
  </div>;
}
