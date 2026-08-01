import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Languages } from "./icons";
import { FocusFlowFrame } from "./fan-shell/focus-flow-frame";
import type { FanLocale } from "./fan-shell/fan-app-shell";
import type { LegalDocumentContent, LegalDocumentId } from "./legal-content";
import { legalLabels } from "./legal-content";
import styles from "./legal-page.module.css";

export function LegalPage({
  document,
  documentId,
  locale,
}: {
  document: LegalDocumentContent;
  documentId: LegalDocumentId;
  locale: FanLocale;
}) {
  const labels = legalLabels[locale];
  const nextLocale = locale === "ko" ? "en" : "ko";
  const pathname = documentId === "privacy" ? "/privacy" : "/terms";

  return (
    <FocusFlowFrame
      locale={locale}
      mainId="legal-document-main"
      showFooter
      headerActions={
        <div className={styles.headerActions}>
          <Link className={styles.homeLink} href={`/?locale=${locale}`} aria-label={labels.homeAriaLabel}>
            <ArrowLeft aria-hidden="true" />
            {labels.home}
          </Link>
          <Link
            className={styles.languageLink}
            data-fan-language-action
            href={`${pathname}?locale=${nextLocale}`}
            aria-label={labels.languageAriaLabel}
          >
            <Languages aria-hidden="true" />
          </Link>
        </div>
      }
    >
      <main className={styles.main} id="legal-document-main" tabIndex={-1}>
        <header className={styles.intro}>
          <p>{labels.notice}</p>
          <h1>{document.title}</h1>
          <span>{labels.effectiveDate}</span>
          <p>{document.description}</p>
        </header>
        <article className={styles.document}>
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.items ? (
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {section.contact ? (
                <p>
                  {section.contact.before}
                  <a href={`mailto:${section.contact.email}`}>{section.contact.email}</a>
                  {section.contact.after}
                </p>
              ) : null}
            </section>
          ))}
        </article>
      </main>
    </FocusFlowFrame>
  );
}
