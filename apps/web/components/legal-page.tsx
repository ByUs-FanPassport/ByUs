import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { FocusFlowFrame } from "./fan-shell/focus-flow-frame";
import styles from "./legal-page.module.css";

export const legalEffectiveDate = "2026년 7월 25일";

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <FocusFlowFrame
      locale="ko"
      mainId="legal-document-main"
      showFooter
      headerActions={
        <Link className={styles.homeLink} href="/" aria-label="홈으로 돌아가기">
          <ArrowLeft aria-hidden="true" />
          홈
        </Link>
      }
    >
      <main className={styles.main} id="legal-document-main" tabIndex={-1}>
        <header className={styles.intro}>
          <p>ByUs 법적 고지</p>
          <h1>{title}</h1>
          <span>시행일: {legalEffectiveDate}</span>
          <p>{description}</p>
        </header>
        <article className={styles.document}>{children}</article>
      </main>
    </FocusFlowFrame>
  );
}
