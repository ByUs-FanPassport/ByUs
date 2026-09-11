import { Suspense, type ReactNode } from "react";
import { PagesSiteFooter } from "@/components/fan-shell/pages-site-footer";
import styles from "./layout.module.css";

export default function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.frame} data-fan-surface>
      {children}
      <Suspense fallback={null}>
        <PagesSiteFooter />
      </Suspense>
    </div>
  );
}
