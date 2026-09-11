import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, CircleHelp, Mail } from "lucide-react";

import { FanAppFrame, FanContentContainer, type FanLocale } from "../fan-shell/fan-app-shell";
import { serviceGuideContent } from "./content";
import { faqStructuredData, serializeStructuredData } from "@/seo/structured-data";
import styles from "./service-guide-page.module.css";

function localeHref(path: string, locale: FanLocale): Route {
  return `${path}?locale=${locale}` as Route;
}

export function ServiceGuidePage({ locale }: { locale: FanLocale }) {
  const t = serviceGuideContent[locale];

  return (
    <FanAppFrame locale={locale} currentPath="/guide" mainId="service-guide-main">
      <script
        id="byus-guide-faq-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(faqStructuredData(t.faqs)) }}
      />
      <FanContentContainer as="main" className={styles.main} id="service-guide-main" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="service-guide-title">
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1 id="service-guide-title">{t.title}</h1>
          <p className={styles.heroDescription}>{t.description}</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href={localeHref("/celebrities", locale)}>
              {t.primaryAction}<ArrowRight aria-hidden="true" />
            </Link>
            <Link className={styles.secondaryAction} href={localeHref("/live", locale)}>
              {t.secondaryAction}
            </Link>
          </div>
        </section>

        <section className={styles.overview} aria-labelledby="service-guide-overview">
          <div className={styles.sectionHeading}>
            <BookOpenCheck aria-hidden="true" />
            <div>
              <h2 id="service-guide-overview">{t.overviewTitle}</h2>
              <p>{t.overviewDescription}</p>
            </div>
          </div>
          <ol className={styles.steps}>
            {t.steps.map((step) => (
              <li key={step.number}>
                <span aria-hidden="true">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.passport} aria-labelledby="service-guide-passport">
          <div>
            <p className={styles.sectionLabel}>FAN PASSPORT</p>
            <h2 id="service-guide-passport">{t.passportTitle}</h2>
            <p>{t.passportDescription}</p>
          </div>
          <ul>{t.passportPoints.map((point) => <li key={point}>{point}</li>)}</ul>
        </section>

        <section className={styles.faq} aria-labelledby="service-guide-faq">
          <div className={styles.sectionHeading}>
            <CircleHelp aria-hidden="true" />
            <h2 id="service-guide-faq">{t.faqTitle}</h2>
          </div>
          <div className={styles.faqList}>
            {t.faqs.map((faq) => (
              <article key={faq.question}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.contact} aria-labelledby="service-guide-contact">
          <Mail aria-hidden="true" />
          <div><h2 id="service-guide-contact">{t.contactTitle}</h2><p>{t.contactDescription}</p></div>
          <a href={`/my/inquiries?locale=${locale}`}>{t.contactAction}</a>
        </section>
      </FanContentContainer>
    </FanAppFrame>
  );
}
