import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { FocusFlowHeader } from "./fan-shell/focus-flow-header";
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
    <div className={styles.page} data-fan-surface lang="ko">
      <FocusFlowHeader className={styles.header} innerClassName={styles.headerInner}>
        <Link className={styles.homeLink} href="/" aria-label="홈으로 돌아가기">
          <ArrowLeft aria-hidden="true" />
          홈
        </Link>
      </FocusFlowHeader>
      <main className={styles.main}>
        <header className={styles.intro}>
          <p>ByUs 법적 고지</p>
          <h1>{title}</h1>
          <span>시행일: {legalEffectiveDate}</span>
          <p>{description}</p>
        </header>
        <article className={styles.document}>{children}</article>
      </main>
      <footer className={styles.footer}>
        <span>© 2026 Sallylab Inc.</span>
        <nav aria-label="법적 문서">
          <Link href="/privacy">개인정보처리방침</Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms">이용약관</Link>
        </nav>
      </footer>
    </div>
  );
}
